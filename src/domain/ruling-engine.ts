import {
  buildRulingInputSchema,
  type BuildRulingInput,
  type JudgeId,
  type JudgeLens,
  type JudgeOpinion,
  type PanelStatus,
  type RulingReport,
  type Vote,
} from "./contracts.js";

const court: ReadonlyArray<{ judgeId: JudgeId; lens: JudgeLens }> = [
  { judgeId: "judge-risk", lens: "RISK" },
  { judgeId: "judge-evidence", lens: "EVIDENCE" },
  { judgeId: "judge-strategy", lens: "STRATEGY" },
];

function majorityVote(approve: number, reject: number): Vote | null {
  if (approve >= 2) return "APPROVE";
  if (reject >= 2) return "REJECT";
  return null;
}

export function buildRulingReport(rawInput: BuildRulingInput): RulingReport {
  const input = buildRulingInputSchema.parse(rawInput);
  const errors: string[] = [];
  const knownEvidence = new Set(input.evidence.map((item) => item.id));
  const responseByJudge = new Map<JudgeId, (typeof input.responses)[number]>();

  for (const response of input.responses) {
    const judgeId = response.ok ? response.ballot.judgeId : response.failure.judgeId;
    if (responseByJudge.has(judgeId)) {
      errors.push("Duplicate response from " + judgeId);
      continue;
    }
    responseByJudge.set(judgeId, response);

    if (response.ok) {
      for (const evidenceId of response.ballot.evidenceIds) {
        if (!knownEvidence.has(evidenceId)) {
          errors.push(judgeId + " cited unknown evidence " + evidenceId);
        }
      }
    }
  }

  const successfulBallots = input.responses.flatMap((response) =>
    response.ok ? [response.ballot] : [],
  );
  const tally = {
    approve: successfulBallots.filter((ballot) => ballot.vote === "APPROVE").length,
    reject: successfulBallots.filter((ballot) => ballot.vote === "REJECT").length,
    abstain: successfulBallots.filter((ballot) => ballot.vote === "ABSTAIN").length,
    unavailable: court.length - successfulBallots.length,
  };

  let verdict = majorityVote(tally.approve, tally.reject) as "APPROVE" | "REJECT" | null;
  let status: PanelStatus;
  if (errors.length > 0) {
    status = "INVALID";
    verdict = null;
  } else if (responseByJudge.size < court.length || tally.unavailable > 0) {
    status = "INCOMPLETE";
    verdict = null;
  } else if (!verdict) {
    status = "INCONCLUSIVE";
  } else if (!input.policyGate.passed) {
    status = "OPPOSED";
    verdict = "REJECT";
  } else {
    status = verdict === "APPROVE" ? "SUPPORTED" : "OPPOSED";
  }

  const opinions = court.map<JudgeOpinion>(({ judgeId, lens }) => {
    const response = responseByJudge.get(judgeId);
    if (!response) {
      return {
        judgeId,
        lens,
        opinionType: "UNAVAILABLE",
        vote: null,
        confidence: null,
        reasonCode: null,
        rationale: "No response was received from this judge.",
        evidenceIds: [],
      };
    }
    if (!response.ok) {
      return {
        judgeId,
        lens,
        opinionType: "UNAVAILABLE",
        vote: null,
        confidence: null,
        reasonCode: null,
        rationale: response.failure.errorCode + ": " + response.failure.message,
        evidenceIds: [],
      };
    }

    const ballot = response.ballot;
    let opinionType: JudgeOpinion["opinionType"] = "SEPARATE_OPINION";
    if (ballot.vote === "ABSTAIN") opinionType = "ABSTENTION";
    else if (verdict && ballot.vote === verdict) opinionType = "MAJORITY";
    else if (verdict && ballot.vote !== verdict) opinionType = "DISSENT";

    return {
      judgeId,
      lens,
      opinionType,
      vote: ballot.vote,
      confidence: ballot.confidence,
      reasonCode: ballot.reasonCode,
      rationale: ballot.rationale,
      evidenceIds: ballot.evidenceIds,
    };
  });

  const judges: RulingReport["judges"] = [opinions[0]!, opinions[1]!, opinions[2]!];
  const supportsSubmittedRoute = status === "SUPPORTED" && input.advisory?.recommendation === "APPROVE"
    && input.advisory.marketBias !== "NEUTRAL";
  const supportsAlternativeRoute = status === "OPPOSED" && input.advisory?.alternativeRoute.direction !== "NEUTRAL";
  const recommendation = supportsSubmittedRoute
    ? {
      status: "ACTIONABLE" as const,
      direction: input.advisory!.marketBias,
      timing: input.advisory!.entryWindow,
      rationale: input.advisory!.thesis,
      conditions: input.advisory!.entryConditions,
      invalidation: input.advisory!.invalidation,
      disclaimer: "Advisory guidance only. Confirm conditions at execution time; Cerebra never places an order.",
    }
    : supportsAlternativeRoute
    ? {
      status: "ACTIONABLE" as const,
      direction: input.advisory!.alternativeRoute.direction,
      timing: input.advisory!.alternativeRoute.timing,
      rationale: input.advisory!.alternativeRoute.rationale,
      conditions: input.advisory!.alternativeRoute.conditions,
      invalidation: input.advisory!.alternativeRoute.invalidation,
      disclaimer: "This is the evidence-bound alternative to the rejected thesis, not an automated order. Confirm conditions at execution time.",
    }
    : {
      status: status === "OPPOSED" || status === "INVALID" ? "NO_TRADE" as const : "WAIT" as const,
      direction: "NEUTRAL" as const,
      timing: "Do not open a position from this ruling.",
      rationale: status === "OPPOSED"
        ? "The court did not support the proposed thesis."
        : "The court does not have a reliable majority basis for a directional recommendation.",
      conditions: ["Gather or refresh the missing evidence, then convene a new court."],
      invalidation: "Any prior thesis is invalid until a new evidence-bound ruling is issued.",
      disclaimer: "Advisory guidance only. Cerebra never places an order.",
    };
  return {
    schemaVersion: "cerebra.ruling-report.v1",
    reportId: input.reportId,
    generatedAt: input.generatedAt,
    proposal: input.proposal,
    status,
    verdict,
    tally,
    judges,
    dissentingJudgeIds: judges
      .filter((opinion) => opinion.opinionType === "DISSENT")
      .map((opinion) => opinion.judgeId),
    evidence: input.evidence,
    policyGate: input.policyGate,
    integrity: { inputHash: input.inputHash, errors },
    recommendation,
  };
}
