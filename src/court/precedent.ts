import type { JudgeId, PanelStatus } from "../domain/contracts.js";

// A compact, attributable prior ruling. Precedents inform context but are never
// evidence for the current case and therefore cannot be cited as market proof.
export type CourtPrecedent = {
  caseId: string;
  runId: string;
  concludedAt: string;
  asset: string;
  market: string;
  timeframe: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  proposalSummary: string;
  status: PanelStatus;
  verdict: "APPROVE" | "REJECT" | null;
  dissentingJudgeIds: JudgeId[];
};

export type PrecedentQuery = {
  agentId: string;
  asset: string;
  market: string;
  excludeCaseId: string;
  limit: number;
};
