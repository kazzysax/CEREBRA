import { z } from "zod";

export const voteSchema = z.enum(["APPROVE", "REJECT", "ABSTAIN"]);
export type Vote = z.infer<typeof voteSchema>;

export const judgeIdSchema = z.enum(["judge-risk", "judge-evidence", "judge-strategy"]);
export type JudgeId = z.infer<typeof judgeIdSchema>;

export const judgeLensSchema = z.enum(["RISK", "EVIDENCE", "STRATEGY"]);
export type JudgeLens = z.infer<typeof judgeLensSchema>;

export const reasonCodeSchema = z.enum([
  "EVIDENCE_SUFFICIENT",
  "EVIDENCE_INSUFFICIENT",
  "RISK_ACCEPTABLE",
  "RISK_EXCESSIVE",
  "STRATEGY_COHERENT",
  "STRATEGY_INCOHERENT",
  "POLICY_CONFLICT",
  "DATA_STALE",
  "OTHER",
]);

export const judgeBallotSchema = z.object({
  judgeId: judgeIdSchema,
  lens: judgeLensSchema,
  vote: voteSchema,
  confidence: z.number().min(0).max(1),
  reasonCode: reasonCodeSchema,
  rationale: z.string().trim().min(1).max(2_000),
  evidenceIds: z.array(z.string().trim().min(1)).max(25),
});
export type JudgeBallot = z.infer<typeof judgeBallotSchema>;

export const failedJudgeResponseSchema = z.object({
  judgeId: judgeIdSchema,
  lens: judgeLensSchema,
  errorCode: z.enum(["TIMEOUT", "MODEL_ERROR", "INVALID_OUTPUT", "CANCELLED"]),
  message: z.string().trim().min(1).max(1_000),
});
export type FailedJudgeResponse = z.infer<typeof failedJudgeResponseSchema>;

export const judgeResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), ballot: judgeBallotSchema }),
  z.object({ ok: z.literal(false), failure: failedJudgeResponseSchema }),
]);
export type JudgeResponse = z.infer<typeof judgeResponseSchema>;

export const evidenceReferenceSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  source: z.string().trim().min(1),
  observedAt: z.string().datetime(),
  uri: z.string().url().optional(),
  digest: z.string().trim().min(1),
  summary: z.string().trim().min(1).max(8_000).optional(),
});
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;

export const panelStatusSchema = z.enum([
  "SUPPORTED",
  "OPPOSED",
  "INCONCLUSIVE",
  "INCOMPLETE",
  "INVALID",
]);
export type PanelStatus = z.infer<typeof panelStatusSchema>;

export const opinionTypeSchema = z.enum([
  "MAJORITY",
  "DISSENT",
  "ABSTENTION",
  "SEPARATE_OPINION",
  "UNAVAILABLE",
]);
export type OpinionType = z.infer<typeof opinionTypeSchema>;

export const judgeOpinionSchema = z.object({
  judgeId: judgeIdSchema,
  lens: judgeLensSchema,
  opinionType: opinionTypeSchema,
  vote: voteSchema.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  reasonCode: reasonCodeSchema.nullable(),
  rationale: z.string().min(1),
  evidenceIds: z.array(z.string()),
});
export type JudgeOpinion = z.infer<typeof judgeOpinionSchema>;

export const rulingReportSchema = z.object({
  schemaVersion: z.literal("cerebra.ruling-report.v1"),
  reportId: z.string().min(1),
  generatedAt: z.string().datetime(),
  proposal: z.object({
    id: z.string().min(1),
    summary: z.string().min(1),
    hash: z.string().min(1),
  }),
  status: panelStatusSchema,
  verdict: z.enum(["APPROVE", "REJECT"]).nullable(),
  tally: z.object({
    approve: z.number().int().nonnegative(),
    reject: z.number().int().nonnegative(),
    abstain: z.number().int().nonnegative(),
    unavailable: z.number().int().nonnegative(),
  }),
  judges: z.tuple([judgeOpinionSchema, judgeOpinionSchema, judgeOpinionSchema]),
  dissentingJudgeIds: z.array(judgeIdSchema),
  evidence: z.array(evidenceReferenceSchema),
  policyGate: z.object({
    passed: z.boolean(),
    policyHash: z.string().min(1),
    violations: z.array(z.string()),
  }),
  integrity: z.object({
    inputHash: z.string().min(1),
    errors: z.array(z.string()),
  }),
  recommendation: z.object({
    status: z.enum(["ACTIONABLE", "WAIT", "NO_TRADE"]),
    direction: z.enum(["LONG", "SHORT", "NEUTRAL"]),
    timing: z.string().min(1),
    rationale: z.string().min(1),
    conditions: z.array(z.string().min(1)),
    invalidation: z.string().min(1),
    disclaimer: z.string().min(1),
  }),
  doctrine: z.object({
    id: z.string().min(1),
    version: z.string().min(1),
    title: z.string().min(1),
    principles: z.array(z.string().min(1)),
    judgeMandates: z.object({
      "judge-risk": z.array(z.string().min(1)),
      "judge-evidence": z.array(z.string().min(1)),
      "judge-strategy": z.array(z.string().min(1)),
    }),
  }).optional(),
});
export type RulingReport = z.infer<typeof rulingReportSchema>;

export const buildRulingInputSchema = z.object({
  reportId: z.string().min(1),
  generatedAt: z.string().datetime(),
  proposal: z.object({
    id: z.string().min(1),
    summary: z.string().min(1),
    hash: z.string().min(1),
  }),
  inputHash: z.string().min(1),
  evidence: z.array(evidenceReferenceSchema),
  responses: z.array(judgeResponseSchema),
  policyGate: z.object({
    passed: z.boolean(),
    policyHash: z.string().min(1),
    violations: z.array(z.string()),
  }),
  advisory: z.object({
    recommendation: z.enum(["APPROVE", "REJECT"]),
    marketBias: z.enum(["LONG", "SHORT", "NEUTRAL"]),
    entryWindow: z.string().min(1),
    entryConditions: z.array(z.string().min(1)).min(1),
    invalidation: z.string().min(1),
    thesis: z.string().min(1),
  }).optional(),
});
export type BuildRulingInput = z.infer<typeof buildRulingInputSchema>;
