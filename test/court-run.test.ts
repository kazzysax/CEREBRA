import assert from "node:assert/strict";
import test from "node:test";
import type { CaseSubmission, CourtModelProvider } from "../src/agents/contracts.js";
import { createMockCourtProvider } from "../src/agents/mock-provider.js";
import { runCourt } from "../src/court/run-court.js";

const submission: CaseSubmission = {
  proposal: {
    id: "btc-long-4h",
    asset: "BTCUSDT",
    market: "spot",
    timeframe: "4h",
    summary: "Approve a provisional BTC long thesis for the next four hours.",
  },
  riskLevel: "MEDIUM",
  evidence: [{
    id: "market-1",
    title: "Synthetic BTC market snapshot",
    source: "test-fixture",
    observedAt: "2026-09-17T10:00:00.000Z",
    digest: "sha256:test-market-1",
  }],
};

test("runs the full mock court and preserves the risk judge dissent", async () => {
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
  assert.deepEqual(result.report.dissentingJudgeIds, ["judge-risk"]);
  assert.equal(result.report.judges[0].opinionType, "DISSENT");
  assert.deepEqual(result.report.doctrine, {
    id: "cerebra-advisory-doctrine",
    version: "v1",
    title: "Evidence before execution",
    principles: [
      "Cerebra gives advisory reports, never trading instructions or guarantees.",
      "A conclusion must be grounded in supplied, attributable evidence; uncertainty must be named.",
      "A proposed execution needs an entry thesis, a defined invalidation condition, and a plausible downside assessment.",
      "Static market snapshots can support an observation but cannot by themselves prove future execution quality.",
      "Material disagreement and missing evidence must remain visible in the final report.",
    ],
    judgeMandates: {
      "judge-risk": [
        "Assess downside, invalidation, liquidity, volatility, and adverse-selection risk.",
        "Reject support when risk cannot be bounded from the supplied evidence.",
      ],
      "judge-evidence": [
        "Assess evidence freshness, attribution, corroboration, contradictions, and material gaps.",
        "Do not treat one static source as confirmation of a claim that requires observation over time.",
      ],
      "judge-strategy": [
        "Assess whether the thesis, timing, market regime, and execution plan are coherent together.",
        "Require a plausible invalidation condition before supporting an execution thesis.",
      ],
    },
  });
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
  assert.equal(result.report.status, "INVALID");
  assert.equal(result.report.verdict, null);
  assert.match(result.report.integrity.errors[0] ?? "", /Analyst cited unknown evidence/);
});
