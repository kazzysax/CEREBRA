import { z } from "zod";
import type { JudgeId } from "../domain/contracts.js";

export const createOutcomeSchema = z.object({
  horizon: z.enum(["1h", "4h", "24h", "7d"]),
  thesisOutcome: z.enum(["CONFIRMED", "REFUTED", "INCONCLUSIVE"]),
  realizedReturnPct: z.number().finite().min(-100).max(10_000).optional(),
  note: z.string().trim().min(1).max(2_000).optional(),
  observedAt: z.string().datetime(),
});
export type CreateOutcome = z.infer<typeof createOutcomeSchema>;

export type OutcomeRecord = CreateOutcome & { id: string; runId: string; agentId: string; recordedAt: string };
export type JudgeCalibration = { judgeId: JudgeId; resolved: number; correct: number; incorrect: number; accuracy: number | null };
