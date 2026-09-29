import assert from "node:assert/strict";
import test from "node:test";
import { createMockCourtProvider } from "../src/agents/mock-provider.js";
import type { CaseRecord } from "../src/storage/contracts.js";
import { createMemoryCaseRepository } from "../src/storage/memory-repository.js";
import { runCourt } from "../src/court/run-court.js";

test("retrieves only relevant owner-scoped completed rulings as precedents", async () => {
  const repository = createMemoryCaseRepository();
  const prior: CaseRecord = {
    id: "prior-btc-case",
    agentId: "agent-a",
    evidenceMode: "MANUAL",
    status: "READY",
    createdAt: "2026-09-19T10:00:00.000Z",
    updatedAt: "2026-09-19T10:00:00.000Z",
    submission: {
      proposal: {
        asset: "BTCUSDT", market: "usdt-futures", timeframe: "4h", direction: "LONG",
        summary: "Evaluate a cautious BTC long after confirmation from market evidence.",
      },
      riskLevel: "MEDIUM",
      evidence: [{
        id: "prior-evidence", title: "Prior BTC observation", source: "test",
        observedAt: "2026-09-19T10:00:00.000Z", digest: "sha256:prior",
      }],
    },
  };
  await repository.createCase(prior);
  const result = await runCourt(prior.submission, createMockCourtProvider(), {
    idFactory: () => "prior-run",
    now: () => new Date("2026-09-19T10:05:00.000Z"),
  });
  await repository.createRun({
    id: "prior-run", caseId: prior.id, status: "RUNNING", provider: result.provider,
    model: result.model, startedAt: result.startedAt, completedAt: null, result: null, error: null,
  });
  await repository.completeRun("prior-run", result, "prior ruling");

  const precedents = await repository.findPrecedents({
    agentId: "agent-a", asset: "BTCUSDT", market: "usdt-futures", excludeCaseId: "new-btc-case", limit: 5,
  });
  assert.deepEqual(precedents, [{
    caseId: "prior-btc-case", runId: "prior-run", concludedAt: result.completedAt,
    asset: "BTCUSDT", market: "usdt-futures", timeframe: "4h", riskLevel: "MEDIUM",
    proposalSummary: "Evaluate a cautious BTC long after confirmation from market evidence.",
    // Manual evidence without measured features: the court declines to pick a side.
    status: "OPPOSED", verdict: "REJECT", dissentingJudgeIds: [],
    outcome: null, realizedReturnPct: null,
  }]);

  // Once the market resolves the ruling, the precedent carries that lesson forward.
  await repository.saveOutcome({
    id: "prior-outcome", runId: "prior-run", agentId: "agent-a", source: "AUTO", horizon: "4h",
    thesisOutcome: "REFUTED", realizedReturnPct: -1.2, observedAt: "2026-09-19T14:05:00.000Z",
    recordedAt: "2026-09-19T14:06:00.000Z",
  });
  const resolved = await repository.findPrecedents({
    agentId: "agent-a", asset: "BTCUSDT", market: "usdt-futures", excludeCaseId: "new-btc-case", limit: 5,
  });
  assert.equal(resolved[0]?.outcome, "REFUTED");
  assert.equal(resolved[0]?.realizedReturnPct, -1.2);

  const isolated = await repository.findPrecedents({
    agentId: "agent-b", asset: "BTCUSDT", market: "usdt-futures", excludeCaseId: "new-btc-case", limit: 5,
  });
  assert.deepEqual(isolated, []);
  await repository.close();
});
