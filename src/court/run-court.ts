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
import { advisoryDoctrineV1, type CourtDoctrine } from "./doctrine.js";
import type { CourtPrecedent } from "./precedent.js";

export type CourtTraceEntry = {
  stage: "ANALYST" | "CHALLENGER" | "JUDGE";
  judgeId: JudgeId | null;
  status: "SUCCEEDED" | "FAILED";
  provider: string;
  model: string;
  usage: ModelUsage;
  error: string | null;
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
};

type RunCourtOptions = {
  now?: (() => Date) | undefined;
  idFactory?: (() => string) | undefined;
  doctrine?: CourtDoctrine | undefined;
  precedents?: CourtPrecedent[] | undefined;
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
): CourtTraceEntry {
  return {
    stage,
    judgeId,
    status: "SUCCEEDED",
    provider: call.provider,
    model: call.model,
    usage: call.usage,
    error: null,
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

function assertKnownCitations(
  submission: CaseSubmission,
  stage: string,
  evidenceIds: readonly string[],
) {
  const knownIds = new Set(submission.evidence.map((item) => item.id));
  const unknownIds = evidenceIds.filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) {
    throw new Error(stage + " cited unknown evidence: " + unknownIds.join(", "));
  }
}

export async function runCourt(
  rawSubmission: unknown,
  provider: CourtModelProvider,
  options: RunCourtOptions = {},
): Promise<CourtRunResult> {
  const submission = caseSubmissionSchema.parse(rawSubmission);
  const now = options.now ?? (() => new Date());
  const idFactory = options.idFactory ?? randomUUID;
  const doctrine = options.doctrine ?? advisoryDoctrineV1;
  const precedents = options.precedents ?? [];
  const runId = idFactory();
  const startedAt = now().toISOString();
  const trace: CourtTraceEntry[] = [];

  const analystCall = await provider.runAnalyst({ submission, precedents });
  trace.push(successfulTrace("ANALYST", null, analystCall));
  assertKnownCitations(
    submission,
    "Analyst",
    analystCall.output.keyClaims.flatMap((claim) => claim.evidenceIds),
  );

  const challengerCall = await provider.runChallenger({
    submission,
    analystCase: analystCall.output,
    precedents,
  });
  trace.push(successfulTrace("CHALLENGER", null, challengerCall));
  assertKnownCitations(
    submission,
    "Challenger",
    challengerCall.output.objections.flatMap((objection) => objection.evidenceIds),
  );

  const judgeSettlements = await Promise.allSettled(
    courtSeats.map(async (seat) => ({
      seat,
      call: await provider.runJudge({
        submission,
        analystCase: analystCall.output,
        challenge: challengerCall.output,
        judgeId: seat.judgeId,
        lens: seat.lens,
        doctrine,
        precedents,
      }),
    })),
  );

  const judgeResponses: JudgeResponse[] = judgeSettlements.map((settlement, index) => {
    const seat = courtSeats[index]!;
    if (settlement.status === "fulfilled") {
      const { call } = settlement.value;
      trace.push(successfulTrace("JUDGE", seat.judgeId, call));
      return {
        ok: true,
        ballot: {
          judgeId: seat.judgeId,
          lens: seat.lens,
          ...call.output,
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
    policyGate: {
      passed: true,
      policyHash: digest(policy),
      violations: [],
    },
    advisory: analystCall.output,
  });
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
    analystCase: analystCall.output,
    challenge: challengerCall.output,
    report,
    trace,
    precedents,
  };
}
