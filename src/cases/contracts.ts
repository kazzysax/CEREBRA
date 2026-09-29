import { z } from "zod";
import { proposalSchema } from "../agents/contracts.js";
import { evidenceReferenceSchema } from "../domain/contracts.js";

export const createCaseSchema = z.object({
  proposal: proposalSchema,
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  evidenceMode: z.enum(["BITGET", "MANUAL"]).default("BITGET"),
  evidence: z.array(evidenceReferenceSchema).max(50).default([]),
}).superRefine((value, context) => {
  // Cerebra covers tokenized U.S. stocks, which Bitget lists as USDT-margined
  // futures only; spot is not offered.
  if (!["usdt-futures", "usdt_futures", "futures", "future", "perp", "perpetual"].includes(value.proposal.market.trim().toLowerCase())) {
    context.addIssue({
      code: "custom",
      path: ["proposal", "market"],
      message: "Only usdt-futures is supported; tokenized U.S. stocks have no Bitget spot market.",
    });
  }
  if (value.evidenceMode === "MANUAL" && value.evidence.length === 0) {
    context.addIssue({
      code: "custom",
      path: ["evidence"],
      message: "Manual cases require at least one evidence item",
    });
  }
});

export const runCaseSchema = z.object({
  refreshEvidence: z.boolean().default(true),
});

export const idParamsSchema = z.object({ id: z.string().trim().min(1) });
export const listCasesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
