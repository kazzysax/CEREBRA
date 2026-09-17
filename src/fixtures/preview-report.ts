import type { BuildRulingInput, JudgeResponse, Vote } from "../domain/contracts.js";
import { buildRulingReport } from "../domain/ruling-engine.js";

export function createPreviewReport(votes: readonly [Vote, Vote, Vote]) {
  const judges = [
    { judgeId: "judge-risk", lens: "RISK" },
    { judgeId: "judge-evidence", lens: "EVIDENCE" },
    { judgeId: "judge-strategy", lens: "STRATEGY" },
  ] as const;

  const responses: JudgeResponse[] = judges.map((judge, index) => ({
    ok: true,
    ballot: {
      ...judge,
      vote: votes[index]!,
      confidence: 0.75,
      reasonCode: votes[index] === "REJECT" ? "RISK_EXCESSIVE" : "EVIDENCE_SUFFICIENT",
      rationale: "Synthetic preview rationale from " + judge.judgeId + ".",
      evidenceIds: ["preview-market-snapshot"],
    },
  }));

  const input: BuildRulingInput = {
    reportId: "preview-report",
    generatedAt: "2026-01-01T00:00:00.000Z",
    proposal: {
      id: "preview-proposal",
      summary: "Synthetic preview only; no live market decision was made.",
      hash: "sha256:preview-proposal",
    },
    inputHash: "sha256:preview-input",
    evidence: [
      {
        id: "preview-market-snapshot",
        title: "Synthetic market snapshot",
        source: "cerebra-fixture",
        observedAt: "2026-01-01T00:00:00.000Z",
        digest: "sha256:preview-evidence",
      },
    ],
    responses,
    policyGate: { passed: true, policyHash: "sha256:preview-policy", violations: [] },
  };

  return buildRulingReport(input);
}
