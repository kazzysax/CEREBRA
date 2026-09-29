import type { JudgeCalibration } from "../outcomes/contracts.js";

// What the court has learned from resolved outcomes. Handed to the Analyst and
// judges so past hits and misses on the same asset inform the next ruling,
// not only the confidence numbers.
export type ResolvedPrecedent = {
  asset: string;
  timeframe: string;
  direction: "LONG" | "SHORT";
  verdict: "APPROVE" | "REJECT" | null;
  outcome: "CONFIRMED" | "REFUTED" | "INCONCLUSIVE";
  realizedReturnPct: number | null;
  concludedAt: string;
};

export type TrackRecord = {
  scope: "AGENT" | "COURT";
  resolved: number;
  confirmed: number;
  refuted: number;
  judges: JudgeCalibration[];
  sameAsset: ResolvedPrecedent[];
};
