import type { JudgeCalibration } from "../outcomes/contracts.js";

// Below this many resolved outcomes a judge's track record is too thin to trust; leave confidence as reported.
const MIN_RESOLVED_FOR_ADJUSTMENT = 3;
// Even a judge with a long, poor track record still gets to state most of its own confidence.
const MAX_SHRINKAGE_WEIGHT = 0.4;
// Resolved-outcome count at which the shrinkage weight reaches half of MAX_SHRINKAGE_WEIGHT.
const SHRINKAGE_HALF_LIFE = 5;

export type CalibrationAdjustment = {
  judgeId: JudgeCalibration["judgeId"];
  rawConfidence: number;
  calibratedConfidence: number;
  weight: number;
  accuracy: number;
  resolved: number;
};

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// Pulls a judge's stated confidence toward its own empirical accuracy from resolved
// post-trade outcomes. This is the mechanism that closes the post-trade feedback loop:
// a judge that has been wrong more often than it sounded confident gets progressively
// throttled, in proportion to how much resolved history backs that track record.
export function calibrateConfidence(
  rawConfidence: number,
  calibration: JudgeCalibration | undefined,
): CalibrationAdjustment | null {
  if (!calibration || calibration.accuracy === null) return null;
  if (calibration.resolved < MIN_RESOLVED_FOR_ADJUSTMENT) return null;

  const weight = MAX_SHRINKAGE_WEIGHT * (calibration.resolved / (calibration.resolved + SHRINKAGE_HALF_LIFE));
  const blended = rawConfidence * (1 - weight) + calibration.accuracy * weight;
  const calibratedConfidence = Math.min(1, Math.max(0, round3(blended)));

  return {
    judgeId: calibration.judgeId,
    rawConfidence,
    calibratedConfidence,
    weight: round3(weight),
    accuracy: calibration.accuracy,
    resolved: calibration.resolved,
  };
}
