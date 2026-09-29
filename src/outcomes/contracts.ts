import { z } from "zod";
import type { JudgeId } from "../domain/contracts.js";

export const outcomeHorizonSchema = z.enum(["15m", "1h", "4h", "24h", "7d"]);

export const createOutcomeSchema = z.object({
  horizon: outcomeHorizonSchema,
  thesisOutcome: z.enum(["CONFIRMED", "REFUTED", "INCONCLUSIVE"]),
  realizedReturnPct: z.number().finite().min(-100).max(10_000).optional(),
  note: z.string().trim().min(1).max(2_000).optional(),
  observedAt: z.string().datetime(),
});
export type CreateOutcome = z.infer<typeof createOutcomeSchema>;

export type OutcomeSource = "AGENT" | "AUTO";
export type OutcomeRecord = CreateOutcome & {
  id: string;
  runId: string;
  agentId: string | null;
  source?: OutcomeSource | undefined;
  recordedAt: string;
};
export type JudgeCalibration = { judgeId: JudgeId; resolved: number; correct: number; incorrect: number; accuracy: number | null };

// A completed run with no outcome yet, as the auto-resolver needs it.
export type AwaitingOutcome = {
  runId: string;
  agentId: string | null;
  completedAt: string;
  asset: string;
  market: string;
  timeframe: string;
  result: unknown;
};
