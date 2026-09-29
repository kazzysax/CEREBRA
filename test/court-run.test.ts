import assert from "node:assert/strict";
import test from "node:test";
import type { CaseSubmission, CourtModelProvider } from "../src/agents/contracts.js";
import { createMockCourtProvider } from "../src/agents/mock-provider.js";
import { runCourt } from "../src/court/run-court.js";
import { advisoryDoctrineV2 } from "../src/court/doctrine.js";
import { featureEvidence } from "./fixtures.js";

const submission: CaseSubmission = {
  proposal: {
    id: "tsla-long-4h",
    asset: "TSLAUSDT",
    market: "usdt-futures",
    timeframe: "4h",
    direction: "LONG",
    summary: "Approve a provisional TSLA long thesis for the next four hours.",
  },
  riskLevel: "MEDIUM",
  // Uptrend with an ask-heavy book: the long is supported, the strategy judge dissents on flow.
  evidence: featureEvidence({ trend: "UP", depth: "ASK_HEAVY" }),
};

test("runs the full mock court and preserves the strategy judge dissent", async () => {
  const provider = createMockCourtProvider();
  let activeJudges = 0;
  let maximumConcurrentJudges = 0;
  const concurrentProvider: CourtModelProvider = {
    ...provider,
    async runJudge(context) {
      activeJudges += 1;
      maximumConcurrentJudges = Math.max(maximumConcurrentJudges, activeJudges);
      await new Promise((resolve) => setTimeout(resolve, 10));
      try {
        return await provider.runJudge(context);
      } finally {
        activeJudges -= 1;
      }
    },
  };

  const dates = [
    new Date("2026-09-17T10:01:00.000Z"),
    new Date("2026-09-17T10:01:01.000Z"),
  ];
  const result = await runCourt(submission, concurrentProvider, {
    idFactory: () => "run-1",
    now: () => dates.shift()!,
  });

  assert.equal(result.report.status, "SUPPORTED");
  assert.equal(result.report.verdict, "APPROVE");
  assert.deepEqual(result.report.dissentingJudgeIds, ["judge-strategy"]);
  assert.equal(result.report.judges[2].opinionType, "DISSENT");
  assert.equal(result.report.doctrine?.version, advisoryDoctrineV2.version);
  assert.deepEqual(result.report.doctrine?.principles, [...advisoryDoctrineV2.principles]);
  // An approved long becomes an actionable plan with levels on the correct side.
  const plan = result.report.recommendation;
  assert.equal(plan.status, "ACTIONABLE");
  assert.equal(plan.source, "SUBMITTED");
  assert.ok(plan.stopPrice! < plan.entryPrice! && plan.entryPrice! < plan.targetPrice!);
  assert.ok(Math.abs(plan.rewardRisk! - 2) <= 0.02, "about 2R after price rounding");
  assert.equal(result.trace.length, 5);
  assert.equal(result.trace[0]?.stage, "ANALYST");
  assert.equal(result.trace[1]?.stage, "CHALLENGER");
  assert.equal(maximumConcurrentJudges, 3);
});

test("returns an incomplete report when one model judge fails", async () => {
  const provider = createMockCourtProvider();
  const failingProvider: CourtModelProvider = {
    ...provider,
    async runJudge(context) {
      if (context.judgeId === "judge-strategy") {
        throw new Error("simulated provider outage");
      }
      return provider.runJudge(context);
    },
  };

  const result = await runCourt(submission, failingProvider, {
    idFactory: () => "run-2",
    now: () => new Date("2026-09-17T10:02:00.000Z"),
  });

  assert.equal(result.report.status, "INCOMPLETE");
  assert.equal(result.report.verdict, null);
  assert.equal(result.report.judges[2].opinionType, "UNAVAILABLE");
  assert.equal(result.trace[4]?.status, "FAILED");
});

test("degrades gracefully instead of aborting when the Analyst cites unknown evidence", async () => {
  const provider = createMockCourtProvider();
  const hallucinatingProvider: CourtModelProvider = {
    ...provider,
    async runAnalyst(context) {
      const call = await provider.runAnalyst(context);
      return {
        ...call,
        output: {
          ...call.output,
          keyClaims: [{ claim: call.output.keyClaims[0]!.claim, evidenceIds: ["EVIDENCE:not-a-real-id"] }],
        },
      };
    },
  };

  const result = await runCourt(submission, hallucinatingProvider, {
    idFactory: () => "run-3",
    now: () => new Date("2026-09-17T10:03:00.000Z"),
  });

  // The whole proceeding still completes—Challenger and all three judges run—
  // rather than throwing and discarding every model call already spent.
  assert.equal(result.trace.length, 5);
  assert.equal(result.trace.every((entry) => entry.status === "SUCCEEDED"), true);
  // A citation slip is stripped and recorded, not allowed to void the ruling.
  assert.equal(result.report.status, "SUPPORTED");
  assert.equal(result.report.integrity.errors.length, 0);
  assert.match(result.report.integrity.warnings?.[0] ?? "", /Analyst cited unknown evidence \(removed\)/);
  assert.deepEqual(result.analystCase.keyClaims[0]!.evidenceIds, []);
});

test("rejects a long that fights a measured downtrend and backs the short only when judges vote for it", async () => {
  const result = await runCourt(
    { ...submission, evidence: featureEvidence({ trend: "DOWN", depth: "ASK_HEAVY" }) },
    createMockCourtProvider(),
    { idFactory: () => "run-4", now: () => new Date("2026-09-17T10:04:00.000Z") },
  );
  assert.equal(result.report.status, "OPPOSED");
  assert.equal(result.analystCase.alternativeRoute.direction, "SHORT");
  assert.equal(result.report.alternativeTally?.approve, 3);
  assert.equal(result.report.recommendation.status, "ACTIONABLE");
  assert.equal(result.report.recommendation.source, "ALTERNATIVE");
  assert.equal(result.report.recommendation.direction, "SHORT");
});

test("does not promote an alternative route the judges did not approve", async () => {
  const provider = createMockCourtProvider();
  const skeptical: CourtModelProvider = {
    ...provider,
    async runJudge(context) {
      const call = await provider.runJudge(context);
      return { ...call, output: { ...call.output, alternativeVote: "REJECT" } };
    },
  };
  const result = await runCourt(
    { ...submission, evidence: featureEvidence({ trend: "DOWN" }) },
    skeptical,
    { idFactory: () => "run-5", now: () => new Date("2026-09-17T10:05:00.000Z") },
  );
  assert.equal(result.report.status, "OPPOSED");
  assert.equal(result.report.recommendation.status, "NO_TRADE");
  assert.equal(result.report.recommendation.direction, "NEUTRAL");
});

test("lets the court pick the side when the agent asks for either", async () => {
  const result = await runCourt(
    { ...submission, proposal: { ...submission.proposal, direction: "EITHER" }, evidence: featureEvidence({ trend: "DOWN", depth: "ASK_HEAVY" }) },
    createMockCourtProvider(),
    { idFactory: () => "run-6", now: () => new Date("2026-09-17T10:06:00.000Z") },
  );
  assert.equal(result.analystCase.marketBias, "SHORT");
  assert.equal(result.report.status, "SUPPORTED");
  assert.equal(result.report.recommendation.direction, "SHORT");
});

test("forces an analyst that approves the opposite side into a rejection with that side as the alternative", async () => {
  const provider = createMockCourtProvider();
  const contrarian: CourtModelProvider = {
    ...provider,
    async runAnalyst(context) {
      const call = await provider.runAnalyst(context);
      return { ...call, output: { ...call.output, recommendation: "APPROVE", marketBias: "SHORT", entryPrice: 120, stopPrice: 123, targetPrice: 114 } };
    },
  };
  const result = await runCourt(submission, contrarian, { idFactory: () => "run-7", now: () => new Date("2026-09-17T10:07:00.000Z") });
  assert.equal(result.analystCase.recommendation, "REJECT");
  assert.equal(result.analystCase.marketBias, "LONG");
  assert.equal(result.analystCase.alternativeRoute.direction, "SHORT");
});
