import { z } from "zod";
import {
  evidenceReferenceSchema,
  judgeIdSchema,
  judgeLensSchema,
  reasonCodeSchema,
  voteSchema,
  type JudgeId,
  type JudgeLens,
} from "../domain/contracts.js";
import type { CourtDoctrine } from "../court/doctrine.js";
import type { CourtPrecedent } from "../court/precedent.js";

export const proposalSchema = z.object({
  id: z.string().trim().min(1).optional(),
  asset: z.string().trim().min(1).max(40),
  market: z.string().trim().min(1).max(40).default("spot"),
  timeframe: z.string().trim().min(1).max(40),
  summary: z.string().trim().min(10).max(4_000),
});

export const caseSubmissionSchema = z.object({
  proposal: proposalSchema,
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH"]),
  evidence: z.array(evidenceReferenceSchema).min(1).max(50),
});
export type CaseSubmission = z.infer<typeof caseSubmissionSchema>;

const citedClaimSchema = z.object({
  claim: z.string().trim().min(1).max(1_000),
  evidenceIds: z.array(z.string().trim().min(1)).min(1).max(10),
});

export const analystCaseSchema = z.object({
  recommendation: z.enum(["APPROVE", "REJECT"]),
  marketBias: z.enum(["LONG", "SHORT", "NEUTRAL"]),
  entryWindow: z.string().trim().min(1).max(240),
  entryConditions: z.array(z.string().trim().min(1).max(500)).min(1).max(5),
  invalidation: z.string().trim().min(1).max(1_000),
  confidence: z.number().min(0).max(1),
  thesis: z.string().trim().min(1).max(2_000),
  keyClaims: z.array(citedClaimSchema).min(1).max(10),
  risks: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
}).strict();
export type AnalystCase = z.infer<typeof analystCaseSchema>;

export const challengeSchema = z.object({
  conclusion: z.string().trim().min(1).max(2_000),
  confidence: z.number().min(0).max(1),
  objections: z.array(z.object({
    objection: z.string().trim().min(1).max(1_000),
    severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    evidenceIds: z.array(z.string().trim().min(1)).max(10),
  })).min(1).max(10),
  missingEvidence: z.array(z.string().trim().min(1).max(500)).max(10),
}).strict();
export type Challenge = z.infer<typeof challengeSchema>;

export const judgeDecisionSchema = z.object({
  vote: voteSchema,
  confidence: z.number().min(0).max(1),
  reasonCode: reasonCodeSchema,
  rationale: z.string().trim().min(1).max(2_000),
  evidenceIds: z.array(z.string().trim().min(1)).max(25),
}).strict();
export type JudgeDecision = z.infer<typeof judgeDecisionSchema>;

export const courtSeats: ReadonlyArray<{ judgeId: JudgeId; lens: JudgeLens }> = [
  { judgeId: judgeIdSchema.enum["judge-risk"], lens: judgeLensSchema.enum.RISK },
  { judgeId: judgeIdSchema.enum["judge-evidence"], lens: judgeLensSchema.enum.EVIDENCE },
  { judgeId: judgeIdSchema.enum["judge-strategy"], lens: judgeLensSchema.enum.STRATEGY },
];

export type ModelUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type ModelCall<T> = {
  output: T;
  provider: string;
  model: string;
  usage: ModelUsage;
};

export type AnalystContext = {
  submission: CaseSubmission;
  precedents: CourtPrecedent[];
};

export type ChallengerContext = {
  submission: CaseSubmission;
  analystCase: AnalystCase;
  precedents: CourtPrecedent[];
};

export type JudgeContext = {
  submission: CaseSubmission;
  analystCase: AnalystCase;
  challenge: Challenge;
  judgeId: JudgeId;
  lens: JudgeLens;
  doctrine: CourtDoctrine;
  precedents: CourtPrecedent[];
};

export interface CourtModelProvider {
  readonly name: string;
  readonly model: string;
  runAnalyst(context: AnalystContext): Promise<ModelCall<AnalystCase>>;
  runChallenger(context: ChallengerContext): Promise<ModelCall<Challenge>>;
  runJudge(context: JudgeContext): Promise<ModelCall<JudgeDecision>>;
}
