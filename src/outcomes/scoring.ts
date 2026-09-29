import type { JudgeOpinion } from "../domain/contracts.js";
import type { ResolvedPrecedent, TrackRecord } from "../court/track-record.js";
import type { JudgeCalibration, OutcomeRecord } from "./contracts.js";

// Below this many resolved outcomes an agent's own history is too thin; the
// court-wide record is used instead so the loop still learns for new agents
// and anonymous portal runs.
export const MIN_AGENT_RESOLVED = 3;

export type ScoredRun = {
  thesisOutcome: OutcomeRecord["thesisOutcome"];
  judges: ReadonlyArray<Pick<JudgeOpinion, "judgeId" | "vote">>;
};

export function scoreJudges(runs: Iterable<ScoredRun>): JudgeCalibration[] {
  const stats = new Map(["judge-risk", "judge-evidence", "judge-strategy"].map((judgeId) => [judgeId, { resolved: 0, correct: 0, incorrect: 0 }]));
  for (const run of runs) {
    if (run.thesisOutcome === "INCONCLUSIVE") continue;
    for (const judge of run.judges) {
      if (!judge.vote || judge.vote === "ABSTAIN") continue;
      const stat = stats.get(judge.judgeId)!;
      stat.resolved += 1;
      const correct = (judge.vote === "APPROVE" && run.thesisOutcome === "CONFIRMED")
        || (judge.vote === "REJECT" && run.thesisOutcome === "REFUTED");
      if (correct) stat.correct += 1; else stat.incorrect += 1;
    }
  }
  return [...stats.entries()].map(([judgeId, stat]) => ({
    judgeId: judgeId as JudgeCalibration["judgeId"],
    ...stat,
    accuracy: stat.resolved ? stat.correct / stat.resolved : null,
  }));
}

export function buildTrackRecord(input: {
  scope: TrackRecord["scope"];
  scored: ScoredRun[];
  sameAsset: ResolvedPrecedent[];
}): TrackRecord {
  const decided = input.scored.filter((run) => run.thesisOutcome !== "INCONCLUSIVE");
  return {
    scope: input.scope,
    resolved: decided.length,
    confirmed: decided.filter((run) => run.thesisOutcome === "CONFIRMED").length,
    refuted: decided.filter((run) => run.thesisOutcome === "REFUTED").length,
    judges: scoreJudges(input.scored),
    sameAsset: input.sameAsset.slice(0, 5),
  };
}
