import assert from "node:assert/strict";
import test from "node:test";
import { executeCase } from "../src/cases/execute-case.js";
import { createMockCourtProvider } from "../src/agents/mock-provider.js";
import { createMockEvidenceProvider } from "../src/evidence/mock-evidence-provider.js";
import type { CaseRecord, CaseRepository } from "../src/storage/contracts.js";
import { createMemoryCaseRepository } from "../src/storage/memory-repository.js";

const submission = {
  proposal: {
    asset: "BTCUSDT", market: "spot", timeframe: "4h",
    summary: "Execute-case hardening test: evaluate a provisional BTC long thesis.",
  },
  riskLevel: "MEDIUM" as const,
  evidence: [{
    id: "ev-1", title: "BTC snapshot", source: "test",
    observedAt: "2026-09-22T00:00:00.000Z", digest: "sha256:test",
  }],
};

async function seedCase(repository: CaseRepository, agentId: string): Promise<CaseRecord> {
  const record: CaseRecord = {
    id: "case-1", agentId, evidenceMode: "MANUAL", status: "READY",
    createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:00:00.000Z",
    submission,
  };
  await repository.createCase(record);
  return record;
}

test("checks the agent's record (precedents and calibration) before handing off to the Analyst", async () => {
  const repository = createMemoryCaseRepository();
  await seedCase(repository, "agent-a");
  const stages: string[] = [];

  await executeCase({
    caseId: "case-1",
    agentId: "agent-a",
    refreshEvidence: false,
    repository,
    evidenceProvider: createMockEvidenceProvider(),
    courtProvider: createMockCourtProvider(),
    onStage: async (stage) => { stages.push(stage); },
  });

  assert.deepEqual(stages, ["EVIDENCE", "RECORD", "ANALYST", "PERSISTING"]);
  await repository.close();
});

test("survives a failed precedent lookup instead of failing the whole run", async () => {
  const repository = createMemoryCaseRepository();
  await seedCase(repository, "agent-a");
  const brokenPrecedents: CaseRepository = {
    ...repository,
    findPrecedents: async () => { throw new Error("simulated precedent read failure"); },
  };

  const result = await executeCase({
    caseId: "case-1",
    agentId: "agent-a",
    refreshEvidence: false,
    repository: brokenPrecedents,
    evidenceProvider: createMockEvidenceProvider(),
    courtProvider: createMockCourtProvider(),
  });

  assert.equal(result.precedents.length, 0);
  assert.equal(result.report.status, "SUPPORTED");
  await repository.close();
});

test("survives a failed calibration lookup instead of failing the whole run", async () => {
  const repository = createMemoryCaseRepository();
  await seedCase(repository, "agent-a");
  const brokenCalibration: CaseRepository = {
    ...repository,
    getJudgeCalibration: async () => { throw new Error("simulated calibration read failure"); },
  };

  const result = await executeCase({
    caseId: "case-1",
    agentId: "agent-a",
    refreshEvidence: false,
    repository: brokenCalibration,
    evidenceProvider: createMockEvidenceProvider(),
    courtProvider: createMockCourtProvider(),
  });

  // No calibration record survived the failed read, so nothing was adjusted—but the
  // run still completed with a real ruling rather than aborting.
  assert.equal(result.trace.every((entry) => entry.calibration === null), true);
  assert.equal(result.report.status, "SUPPORTED");
  await repository.close();
});
