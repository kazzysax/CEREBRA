import { marketFeaturesOf, type RouteCheck } from "../court/risk-check.js";
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
    model: "cerebra-deterministic-mock-v2",
    usage: mockUsage,
  };
}

type Side = "LONG" | "SHORT";

function plan(side: Side, last: number, atr: number) {
  const sign = side === "LONG" ? 1 : -1;
  const round = (value: number) => Math.round(value * 100) / 100;
  return { entryPrice: round(last), stopPrice: round(last - sign * 0.75 * atr), targetPrice: round(last + sign * 1.5 * atr) };
}

function noLevels() {
  return { entryPrice: null, stopPrice: null, targetPrice: null };
}

// Deterministic rules over the measured features: trade with the measured
// trend, bound risk at 0.75 ATR, target 2R. Without features (manual evidence)
// the mock stays neutral rather than inventing a direction.
export function createMockCourtProvider(): CourtModelProvider {
  return {
    name: "mock",
    model: "cerebra-deterministic-mock-v2",

    async runAnalyst({ submission }: AnalystContext): Promise<ModelCall<AnalystCase>> {
      const evidenceIds = submission.evidence.map((item) => item.id);
      const features = marketFeaturesOf(submission);
      const trend = features?.candles?.trend ?? "SIDEWAYS";
      const supported: Side | null = trend === "UP" ? "LONG" : trend === "DOWN" ? "SHORT" : null;
      const requested = submission.proposal.direction;
      const atr = features?.candles?.atr ?? null;
      const last = features?.lastPrice ?? null;
      const levelsFor = (side: Side) => last !== null && atr !== null ? plan(side, last, atr) : noLevels();

      const side: Side | null = requested === "EITHER" ? supported : requested;
      const approve = side !== null && side === supported && last !== null && atr !== null;
      const alternative = !approve && supported && supported !== side ? supported : null;

      return result({
        recommendation: approve ? "APPROVE" : "REJECT",
        marketBias: side ?? "NEUTRAL",
        ...(side ? levelsFor(side) : noLevels()),
        entryWindow: "Within the proposal timeframe while price holds the measured structure.",
        entryConditions: ["Re-check that the measured trend (" + trend + ") still holds immediately before acting."],
        invalidation: "Exit if price crosses the stop level or the measured trend flips.",
        alternativeRoute: alternative
          ? {
            direction: alternative,
            ...levelsFor(alternative),
            timing: "Within the proposal timeframe.",
            rationale: "The measured " + trend + " trend supports the " + alternative + " side instead.",
            conditions: ["Trend classification remains " + trend + "."],
            invalidation: "Exit if price crosses the stop level.",
          }
          : {
            direction: "NEUTRAL",
            ...noLevels(),
            timing: "Wait for a new evidence packet.",
            rationale: "No opposite-direction route is supported by the measured data.",
            conditions: ["Collect current market evidence."],
            invalidation: "Do not act on an alternative route without a new ruling.",
          },
        confidence: approve ? 0.66 : 0.6,
        thesis: features
          ? "Measured trend is " + trend + "; the " + (side ?? "submitted") + " side is " + (approve ? "supported" : "not supported") + " by the data."
          : "No measured market features were supplied, so no direction can be supported.",
        keyClaims: [{ claim: "The measured features determine the supported side.", evidenceIds: evidenceIds.slice(0, 1) }],
        risks: ["Market conditions can change after the evidence observation time."],
      });
    },

    async runChallenger({ submission, riskCheck }: ChallengerContext): Promise<ModelCall<Challenge>> {
      const failsBudget = riskCheck ? !riskCheck.primary.withinRiskBudget : true;
      return result({
        conclusion: failsBudget
          ? "The primary plan does not meet the court's risk budget."
          : "The primary plan is bounded; the main risk is a trend reversal.",
        confidence: 0.6,
        objections: [{
          objection: failsBudget ? "Reward/risk or stop placement fails the risk budget." : "A reversal would hit the stop.",
          severity: failsBudget ? "HIGH" : "MEDIUM",
          evidenceIds: [submission.evidence[0]!.id],
        }],
        missingEvidence: [],
      });
    },

    async runJudge(context: JudgeContext): Promise<ModelCall<JudgeDecision>> {
      const evidenceIds = context.submission.evidence.map((item) => item.id).slice(0, 1);
      const check = context.riskCheck;
      const approves = (route: RouteCheck | null | undefined): boolean => {
        if (!route || route.direction === "NEUTRAL" || !route.levelsValid) return false;
        if (context.judgeId === "judge-risk") return route.withinRiskBudget;
        if (context.judgeId === "judge-evidence") return route.trendAligned === true;
        return route.trendAligned !== false && route.depthAligned !== false;
      };
      const primaryApproved = context.analystCase.recommendation === "APPROVE" && approves(check?.primary);
      const alternativeOffered = context.analystCase.alternativeRoute.direction !== "NEUTRAL";
      const codes = {
        "judge-risk": ["RISK_ACCEPTABLE", "RISK_EXCESSIVE"],
        "judge-evidence": ["EVIDENCE_SUFFICIENT", "EVIDENCE_INSUFFICIENT"],
        "judge-strategy": ["STRATEGY_COHERENT", "STRATEGY_INCOHERENT"],
      } as const;
      return result({
        vote: primaryApproved ? "APPROVE" : "REJECT",
        alternativeVote: alternativeOffered ? (approves(check?.alternative) ? "APPROVE" : "REJECT") : null,
        confidence: primaryApproved ? 0.68 : 0.64,
        reasonCode: codes[context.judgeId][primaryApproved ? 0 : 1],
        rationale: "Deterministic " + context.lens.toLowerCase() + " check: " + (check?.primary.findings.join(" ") || "no measured plan to check."),
        evidenceIds,
      });
    },
  };
}
