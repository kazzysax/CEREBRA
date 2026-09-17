import assert from "node:assert/strict";
import test from "node:test";
import type { BuildRulingInput, JudgeResponse, Vote } from "../src/domain/contracts.js";
import { buildRulingReport } from "../src/domain/ruling-engine.js";

function makeInput(votes: readonly Vote[]): BuildRulingInput {
  const judges = [
    { judgeId: "judge-risk", lens: "RISK" },
    { judgeId: "judge-evidence", lens: "EVIDENCE" },
    { judgeId: "judge-strategy", lens: "STRATEGY" },
  ] as const;
  const responses: JudgeResponse[] = votes.map((vote, index) => ({
    ok: true,
    ballot: {
      ...judges[index]!,
      vote,
      confidence: 0.8,
      reasonCode: vote === "REJECT" ? "RISK_EXCESSIVE" : "EVIDENCE_SUFFICIENT",
      rationale: judges[index]!.judgeId + " explains " + vote + ".",
      evidenceIds: ["e1"],
    },
  }));
  return {
    reportId: "report-1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    proposal: { id: "proposal-1", summary: "Test proposal", hash: "proposal-hash" },
    inputHash: "input-hash",
    evidence: [{
      id: "e1",
      title: "Evidence one",
      source: "test",
      observedAt: "2026-01-01T00:00:00.000Z",
      digest: "evidence-hash",
    }],
    responses,
    policyGate: { passed: true, policyHash: "policy-hash", violations: [] },
  };
}

test("records the losing judge as dissent in a 2-1 decision", () => {
  const report = buildRulingReport(makeInput(["APPROVE", "APPROVE", "REJECT"]));
  assert.equal(report.status, "SUPPORTED");
  assert.equal(report.verdict, "APPROVE");
  assert.deepEqual(report.dissentingJudgeIds, ["judge-strategy"]);
  assert.equal(report.judges[2].opinionType, "DISSENT");
  assert.match(report.judges[2].rationale, /REJECT/);
});

test("returns inconclusive when no side has two votes", () => {
  const report = buildRulingReport(makeInput(["APPROVE", "REJECT", "ABSTAIN"]));
  assert.equal(report.status, "INCONCLUSIVE");
  assert.equal(report.verdict, null);
});

test("returns incomplete when a judge times out", () => {
  const input = makeInput(["APPROVE", "APPROVE"]);
  input.responses.push({
    ok: false,
    failure: {
      judgeId: "judge-strategy",
      lens: "STRATEGY",
      errorCode: "TIMEOUT",
      message: "Qwen request exceeded its deadline.",
    },
  });
  const report = buildRulingReport(input);
  assert.equal(report.status, "INCOMPLETE");
  assert.equal(report.judges[2].opinionType, "UNAVAILABLE");
});

test("invalidates a report when a judge cites unknown evidence", () => {
  const input = makeInput(["APPROVE", "APPROVE", "REJECT"]);
  const response = input.responses[0];
  if (response?.ok) response.ballot.evidenceIds = ["missing-evidence"];
  const report = buildRulingReport(input);
  assert.equal(report.status, "INVALID");
  assert.match(report.integrity.errors[0] ?? "", /unknown evidence/);
});
