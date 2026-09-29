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
  const errors: string[] = [...(input.priorErrors ?? [])];
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
      alternativeVote: ballot.alternativeVote ?? null,
    };
  });

  const judges: RulingReport["judges"] = [opinions[0]!, opinions[1]!, opinions[2]!];
  const advisory = input.advisory;
  const alternativeOffered = Boolean(advisory && advisory.alternativeRoute.direction !== "NEUTRAL");
  const alternativeTally = alternativeOffered
    ? {
      approve: successfulBallots.filter((ballot) => ballot.alternativeVote === "APPROVE").length,
      reject: successfulBallots.filter((ballot) => ballot.alternativeVote === "REJECT").length,
      abstain: successfulBallots.filter((ballot) => ballot.alternativeVote === "ABSTAIN").length,
    }
    : null;
  // A missing risk check (legacy callers) does not block; a present one must
  // show levels on the correct side of entry before anything is actionable.
  const primaryLevelsOk = input.riskCheck ? input.riskCheck.primary.levelsValid : true;
  const alternativeLevelsOk = input.riskCheck ? Boolean(input.riskCheck.alternative?.levelsValid) : true;

  const supportsSubmittedRoute = status === "SUPPORTED" && advisory?.recommendation === "APPROVE"
    && advisory.marketBias !== "NEUTRAL" && primaryLevelsOk;
  // The alternative is only court-backed when a majority of judges voted for it
  // separately. It is never promoted just because the thesis was rejected.
  const supportsAlternativeRoute = status === "OPPOSED" && alternativeOffered
    && (alternativeTally?.approve ?? 0) >= 2 && alternativeLevelsOk;
  const recommendation: RulingReport["recommendation"] = supportsSubmittedRoute
    ? {
      status: "ACTIONABLE",
      direction: advisory!.marketBias,
      source: "SUBMITTED",
      entryPrice: advisory!.entryPrice ?? null,
      stopPrice: advisory!.stopPrice ?? null,
      targetPrice: advisory!.targetPrice ?? null,
      rewardRisk: input.riskCheck?.primary.rewardRisk ?? null,
      timing: advisory!.entryWindow,
      rationale: advisory!.thesis,
      conditions: advisory!.entryConditions,
      invalidation: advisory!.invalidation,
      disclaimer: "Advisory guidance only. Confirm conditions at execution time; Cerebra never places an order.",
    }
    : supportsAlternativeRoute
    ? {
      status: "ACTIONABLE",
      direction: advisory!.alternativeRoute.direction,
      source: "ALTERNATIVE",
      entryPrice: advisory!.alternativeRoute.entryPrice ?? null,
      stopPrice: advisory!.alternativeRoute.stopPrice ?? null,
      targetPrice: advisory!.alternativeRoute.targetPrice ?? null,
      rewardRisk: input.riskCheck?.alternative?.rewardRisk ?? null,
      timing: advisory!.alternativeRoute.timing,
      rationale: advisory!.alternativeRoute.rationale,
      conditions: advisory!.alternativeRoute.conditions,
      invalidation: advisory!.alternativeRoute.invalidation,
      disclaimer: "The submitted thesis was rejected; a majority of judges separately approved this alternative. Advisory only, never an automated order.",
    }
    : {
      status: status === "OPPOSED" || status === "INVALID" ? "NO_TRADE" : "WAIT",
      direction: "NEUTRAL",
      source: "NONE",
      entryPrice: null,
      stopPrice: null,
      targetPrice: null,
      rewardRisk: null,
      timing: "Do not open a position from this ruling.",
      rationale: status === "OPPOSED"
        ? alternativeOffered
          ? "The court rejected the submitted thesis and did not give the alternative route a majority either."
          : "The court did not support the proposed thesis."
        : status === "SUPPORTED"
        ? "The judges supported the thesis, but the plan lacks valid entry, stop and target levels, so it is not actionable yet."
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
    integrity: { inputHash: input.inputHash, errors, warnings: input.warnings ?? [] },
    recommendation,
    alternativeTally,
  };
}
