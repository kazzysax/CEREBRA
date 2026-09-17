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
