import { createHash, randomUUID } from "node:crypto";
import {
  caseSubmissionSchema,
  courtSeats,
  type AnalystCase,
  type CaseSubmission,
  type Challenge,
  type CourtModelProvider,
  type ModelCall,
  type ModelUsage,
} from "../agents/contracts.js";
import {
  type JudgeId,
  type JudgeResponse,
  type RulingReport,
} from "../domain/contracts.js";
import { buildRulingReport } from "../domain/ruling-engine.js";
import type { JudgeCalibration } from "../outcomes/contracts.js";
import { calibrateConfidence, type CalibrationAdjustment } from "./calibration.js";
import { advisoryDoctrineV2, type CourtDoctrine } from "./doctrine.js";
import type { CourtPrecedent } from "./precedent.js";
import { computeRiskCheck, withTrendRoute, type RiskCheck } from "./risk-check.js";
import type { TrackRecord } from "./track-record.js";
import type { AgentMemory } from "./agent-memory.js";

export type CourtTraceEntry = {
  stage: "ANALYST" | "CHALLENGER" | "JUDGE";
  judgeId: JudgeId | null;
  status: "SUCCEEDED" | "FAILED";
  provider: string;
  model: string;
  usage: ModelUsage;
  error: string | null;
  calibration: CalibrationAdjustment | null;
};

export type CourtRunResult = {
  runId: string;
  startedAt: string;
  completedAt: string;
  provider: string;
  model: string;
  analystCase: AnalystCase;
  challenge: Challenge;
  report: RulingReport;
  trace: CourtTraceEntry[];
  precedents: CourtPrecedent[];
  riskCheck?: RiskCheck | undefined;
};

type RunCourtOptions = {
  now?: (() => Date) | undefined;
  idFactory?: (() => string) | undefined;
  doctrine?: CourtDoctrine | undefined;
  precedents?: CourtPrecedent[] | undefined;
  calibration?: JudgeCalibration[] | undefined;
  trackRecord?: TrackRecord | null | undefined;
  agentMemory?: AgentMemory | null | undefined;
};

const emptyUsage: ModelUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  const json = JSON.stringify(stableValue(value));
  return "sha256:" + createHash("sha256").update(json).digest("hex");
}

function successfulTrace(
  stage: CourtTraceEntry["stage"],
  judgeId: JudgeId | null,
  call: ModelCall<unknown>,
  calibration: CalibrationAdjustment | null = null,
): CourtTraceEntry {
  return {
    stage,
    judgeId,
    status: "SUCCEEDED",
    provider: call.provider,
    model: call.model,
    usage: call.usage,
    error: null,
    calibration,
  };
}

function safeError(error: unknown): string {
  if (error instanceof Error) return (error.name + ": " + error.message).slice(0, 500);
  return "Unknown model provider error";
}

function failureCode(error: unknown): "TIMEOUT" | "MODEL_ERROR" {
  if (error instanceof Error && /abort|timeout/i.test(error.name + " " + error.message)) {
    return "TIMEOUT";
  }
  return "MODEL_ERROR";
}

// A stage citing an unknown evidence ID used to void the whole ruling, and
// that happened on roughly one live run in five over formatting slips. The
// citation is now stripped and recorded as a warning: the ruling stays valid,
// the slip stays auditable.
function knownOnly(
  submission: CaseSubmission,
  stage: string,
  evidenceIds: readonly string[],
  warnings: string[],
): string[] {
  const knownIds = new Set(submission.evidence.map((item) => item.id));
  const unknownIds = evidenceIds.filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) warnings.push(stage + " cited unknown evidence (removed): " + unknownIds.join(", ").slice(0, 300));
  return evidenceIds.filter((id) => knownIds.has(id));
}

// Keep the Analyst's recommendation, bias and levels mutually consistent. Live
// runs produced APPROVE with a NEUTRAL bias (never actionable) and approvals of
// the opposite side from the one the agent asked about.
function coherentAnalystCase(submission: CaseSubmission, analyst: AnalystCase): AnalystCase {
  const requested = submission.proposal.direction;
  const clearLevels = { entryPrice: null, stopPrice: null, targetPrice: null };
  if (requested !== "EITHER" && analyst.marketBias !== requested) {
    const opposite = analyst.marketBias !== "NEUTRAL";
    return {
      ...analyst,
      recommendation: "REJECT",
      marketBias: requested,
      ...clearLevels,
      alternativeRoute: opposite && analyst.alternativeRoute.direction === "NEUTRAL"
        ? {
          direction: analyst.marketBias,
          entryPrice: analyst.entryPrice,
          stopPrice: analyst.stopPrice,
          targetPrice: analyst.targetPrice,
          timing: analyst.entryWindow,
          rationale: analyst.thesis,
          conditions: analyst.entryConditions,
          invalidation: analyst.invalidation,
        }
        : analyst.alternativeRoute,
    };
  }
  // With no side requested, a side the Analyst argues for belongs in the primary
  // plan (seen live: the model parked its SHORT in the alternative slot and left
  // the primary NEUTRAL, so the judges never voted on it as the recommendation).
  if (requested === "EITHER" && analyst.marketBias === "NEUTRAL" && analyst.alternativeRoute.direction !== "NEUTRAL") {
    const route = analyst.alternativeRoute;
    return {
      ...analyst,
      recommendation: "APPROVE",
      marketBias: route.direction,
      entryPrice: route.entryPrice,
      stopPrice: route.stopPrice,
      targetPrice: route.targetPrice,
      entryWindow: route.timing,
      entryConditions: route.conditions,
      invalidation: route.invalidation,
      thesis: route.rationale,
      alternativeRoute: {
        direction: "NEUTRAL", entryPrice: null, stopPrice: null, targetPrice: null,
        timing: "No alternative route.", rationale: "The supported side is the primary plan.",
        conditions: ["Re-run the court on new evidence."], invalidation: "Not applicable.",
      },
    };
  }
  if (analyst.recommendation === "APPROVE" && analyst.marketBias === "NEUTRAL") {
    return { ...analyst, recommendation: "REJECT", ...clearLevels };
  }
  return analyst;
}

export async function runCourt(
  rawSubmission: unknown,
  provider: CourtModelProvider,
  options: RunCourtOptions = {},
): Promise<CourtRunResult> {
  const submission = caseSubmissionSchema.parse(rawSubmission);
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;
  const doctrine = options.doctrine ?? advisoryDoctrineV2;
  const precedents = options.precedents ?? [];
  const calibrationByJudge = new Map(
    (options.calibration ?? []).map((entry) => [entry.judgeId, entry] as const),
  );
  const runId = idFactory();
  const startedAt = now().toISOString();
  const trace: CourtTraceEntry[] = [];
  const warnings: string[] = [];
  const trackRecord = options.trackRecord ?? null;
  const agentMemory = options.agentMemory ?? null;

  const analystCall = await provider.runAnalyst({ submission, precedents, trackRecord, agentMemory });
  trace.push(successfulTrace("ANALYST", null, analystCall));
  const coherentCase = coherentAnalystCase(submission, {
    ...analystCall.output,
    keyClaims: analystCall.output.keyClaims.map((claim) => ({
      ...claim,
      evidenceIds: knownOnly(submission, "Analyst", claim.evidenceIds, warnings),
    })),
  });
  const trendRoute = withTrendRoute(submission, coherentCase);
  const analystCase = trendRoute.analystCase;
  if (trendRoute.supplied) {
    warnings.push("The Analyst offered no plan the measured trend supports, so the court put its computed reference plan forward as the alternative route for the judges to rule on.");
  }
  const riskCheck = computeRiskCheck(submission, analystCase);

  const challengerCall = await provider.runChallenger({
    submission,
    analystCase,
    precedents,
    riskCheck,
    agentMemory,
  });
  trace.push(successfulTrace("CHALLENGER", null, challengerCall));
  const challenge: Challenge = {
    ...challengerCall.output,
    objections: challengerCall.output.objections.map((objection) => ({
      ...objection,
      evidenceIds: knownOnly(submission, "Challenger", objection.evidenceIds, warnings),
    })),
  };

  const judgeSettlements = await Promise.allSettled(
    courtSeats.map(async (seat) => ({
      seat,
      call: await provider.runJudge({
        submission,
        analystCase,
        challenge,
        judgeId: seat.judgeId,
        lens: seat.lens,
        doctrine,
        precedents,
        calibration: calibrationByJudge.get(seat.judgeId) ?? null,
        riskCheck,
        trackRecord,
        agentMemory,
      }),
    })),
  );

  const judgeResponses: JudgeResponse[] = judgeSettlements.map((settlement, index) => {
    const seat = courtSeats[index]!;
    if (settlement.status === "fulfilled") {
      const { call } = settlement.value;
      const adjustment = calibrateConfidence(
        call.output.confidence,
        calibrationByJudge.get(seat.judgeId),
      );
      trace.push(successfulTrace("JUDGE", seat.judgeId, call, adjustment));
      const rationale = adjustment
        ? call.output.rationale.slice(0, 1800) +
          " [Confidence calibrated from " + adjustment.rawConfidence +
          " to " + adjustment.calibratedConfidence + " using " + adjustment.resolved +
          " resolved outcomes; historical accuracy " + Math.round(adjustment.accuracy * 100) + "%.]"
        : call.output.rationale;
      return {
        ok: true,
        ballot: {
          judgeId: seat.judgeId,
          lens: seat.lens,
          ...call.output,
          evidenceIds: knownOnly(submission, seat.judgeId, call.output.evidenceIds, warnings),
          confidence: adjustment ? adjustment.calibratedConfidence : call.output.confidence,
          rationale,
        },
      };
    }

    const message = safeError(settlement.reason);
    trace.push({
      stage: "JUDGE",
      judgeId: seat.judgeId,
      status: "FAILED",
      provider: provider.name,
      model: provider.model,
      usage: emptyUsage,
      error: message,
      calibration: null,
    });
    return {
      ok: false,
      failure: {
        judgeId: seat.judgeId,
        lens: seat.lens,
        errorCode: failureCode(settlement.reason),
        message,
      },
    };
  });

  const completedAt = now().toISOString();
  const proposalId = submission.proposal.id ?? "proposal-" + runId;
  const proposal = {
    id: proposalId,
    summary: submission.proposal.summary,
    hash: digest(submission.proposal),
  };
  const policy = {
    version: "cerebra-advisory-policy.v1",
    riskLevel: submission.riskLevel,
  };
  const report = buildRulingReport({
    reportId: "report-" + runId,
    generatedAt: completedAt,
    proposal,
    inputHash: digest(submission),
    evidence: submission.evidence,
    responses: judgeResponses,
    warnings,
    riskCheck,
    policyGate: {
      passed: true,
      policyHash: digest(policy),
      violations: [],
    },
    advisory: analystCase,
  });
  report.riskCheck = riskCheck as unknown as Record<string, unknown>;
  const memorySummary = agentMemory
    ? {
      strategyVersion: agentMemory.strategy?.version ?? null,
      freshBeliefs: agentMemory.fresh,
      staleBeliefs: agentMemory.stale,
      undatedBeliefs: agentMemory.beliefs.length - agentMemory.fresh - agentMemory.stale,
    }
    : null;
  report.learning = trackRecord || agentMemory
    ? {
      scope: trackRecord?.scope ?? "COURT",
      resolvedOutcomes: trackRecord?.resolved ?? 0,
      confirmed: trackRecord?.confirmed ?? 0,
      refuted: trackRecord?.refuted ?? 0,
      sameAssetPrecedents: trackRecord?.sameAsset.length ?? 0,
      calibratedJudges: trace.filter((entry) => entry.calibration).map((entry) => entry.judgeId),
      agentMemory: memorySummary,
    }
    : null;
  report.doctrine = {
    id: doctrine.id,
    version: doctrine.version,
    title: doctrine.title,
    principles: [...doctrine.principles],
    judgeMandates: {
      "judge-risk": [...doctrine.judgeMandates["judge-risk"]],
      "judge-evidence": [...doctrine.judgeMandates["judge-evidence"]],
      "judge-strategy": [...doctrine.judgeMandates["judge-strategy"]],
    },
  };

  return {
    runId,
    startedAt,
    completedAt,
    provider: provider.name,
    model: provider.model,
    analystCase,
    challenge,
    report,
    trace,
    precedents,
    riskCheck,
  };
}
