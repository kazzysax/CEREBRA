import type {
  AnalystCase,
  AnalystContext,
  Challenge,
  ChallengerContext,
  CourtModelProvider,
  JudgeContext,
  JudgeDecision,
  ModelCall,
} from "./contracts.js";

const mockUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 } as const;

function result<T>(output: T): ModelCall<T> {
  return {
    output,
    provider: "mock",
    model: "cerebra-deterministic-mock-v1",
    usage: mockUsage,
  };
}

export function createMockCourtProvider(): CourtModelProvider {
  return {
    name: "mock",
    model: "cerebra-deterministic-mock-v1",

    async runAnalyst({ submission }: AnalystContext): Promise<ModelCall<AnalystCase>> {
      const evidenceIds = submission.evidence.map((item) => item.id);
      return result({
        recommendation: "APPROVE",
        confidence: 0.72,
        thesis: "The supplied evidence supports testing the proposal, subject to the stated risk controls.",
        keyClaims: [{
          claim: "The proposal has at least one traceable item of supporting evidence.",
          evidenceIds,
        }],
        risks: [
          "Market conditions can change after the evidence observation time.",
          "Synthetic mode cannot verify live liquidity or execution quality.",
        ],
      });
    },

    async runChallenger({
      submission,
      analystCase,
    }: ChallengerContext): Promise<ModelCall<Challenge>> {
      return result({
        conclusion: "The Analyst case is plausible but may understate downside and evidence staleness.",
        confidence: Math.min(0.9, analystCase.confidence + 0.08),
        objections: [{
          objection: "The supplied snapshot may not represent conditions at execution time.",
          severity: submission.riskLevel === "HIGH" ? "CRITICAL" : "HIGH",
          evidenceIds: [submission.evidence[0]!.id],
        }],
        missingEvidence: [
          "Live order-book depth",
          "A clearly defined invalidation level",
        ],
      });
    },

    async runJudge(context: JudgeContext): Promise<ModelCall<JudgeDecision>> {
      const evidenceIds = context.submission.evidence.map((item) => item.id);
      if (context.judgeId === "judge-risk") {
        return result({
          vote: "REJECT",
          confidence: 0.78,
          reasonCode: "RISK_EXCESSIVE",
          rationale: "The proposal does not yet quantify execution risk or a hard invalidation level.",
          evidenceIds,
        });
      }
      if (context.judgeId === "judge-evidence") {
        return result({
          vote: "APPROVE",
          confidence: 0.74,
          reasonCode: "EVIDENCE_SUFFICIENT",
          rationale: "The cited evidence is traceable and sufficient for a provisional advisory ruling.",
          evidenceIds,
        });
      }
      return result({
        vote: "APPROVE",
        confidence: 0.7,
        reasonCode: "STRATEGY_COHERENT",
        rationale: "The proposal and Analyst thesis form a coherent strategy when the stated risks are observed.",
        evidenceIds,
      });
    },
  };
}
