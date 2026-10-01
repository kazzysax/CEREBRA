import type { AnalystCase, CaseSubmission } from "../agents/contracts.js";
import type { BetterLevel } from "../domain/contracts.js";
import type { MarketFeatures } from "../evidence/market-features.js";

type Direction = "LONG" | "SHORT" | "NEUTRAL";

export type RouteCheck = {
  direction: Direction;
  entry: number | null;
  stop: number | null;
  target: number | null;
  riskPct: number | null;
  rewardPct: number | null;
  rewardRisk: number | null;
  stopAtr: number | null;
  levelsValid: boolean;
  trendAligned: boolean | null;
  depthAligned: boolean | null;
  withinRiskBudget: boolean;
  findings: string[];
};

export type RiskCheck = {
  riskLevel: CaseSubmission["riskLevel"];
  // maxStopAtr limits the stop only; maxTargetAtr limits how far the target may be.
  budget: { minRewardRisk: number; maxStopAtr: number; maxTargetAtr?: number };
  lastPrice: number | null;
  trend: "UP" | "DOWN" | "SIDEWAYS" | null;
  depthBias: "BID_HEAVY" | "ASK_HEAVY" | "BALANCED" | null;
  primary: RouteCheck;
  alternative: RouteCheck | null;
  referencePlans?: ReturnType<typeof referencePlans> | undefined;
};

// Risk posture sets how much edge a plan must show before it is fundable.
// Candles are fetched at the horizon's own interval, so one ATR is roughly the
// range of the whole horizon: stops and targets must fit inside a bar or two,
// not the multi-bar swings a longer holding period would allow.
export const riskBudgets: Record<CaseSubmission["riskLevel"], { minRewardRisk: number; maxStopAtr: number }> = {
  LOW: { minRewardRisk: 2, maxStopAtr: 1 },
  MEDIUM: { minRewardRisk: 1.5, maxStopAtr: 1.25 },
  HIGH: { minRewardRisk: 1.2, maxStopAtr: 1.5 },
};

// A target further than this many ATR rarely prints within one horizon bar.
export const MAX_REACHABLE_TARGET_ATR = 2;

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function marketFeaturesOf(submission: CaseSubmission): MarketFeatures | null {
  const item = submission.evidence.find((entry) => entry.metrics && typeof entry.metrics.lastPrice === "number");
  return (item?.metrics as MarketFeatures | undefined) ?? null;
}

function checkRoute(
  direction: Direction,
  levels: { entry: number | null; stop: number | null; target: number | null },
  features: MarketFeatures | null,
  budget: RiskCheck["budget"],
): RouteCheck {
  const findings: string[] = [];
  const entry = levels.entry ?? features?.lastPrice ?? null;
  const { stop, target } = levels;
  const atr = features?.candles?.atr ?? null;
  const base: RouteCheck = {
    direction, entry, stop, target,
    riskPct: null, rewardPct: null, rewardRisk: null, stopAtr: null,
    levelsValid: false, trendAligned: null, depthAligned: null, withinRiskBudget: false, findings,
  };
  if (direction === "NEUTRAL") {
    findings.push("No directional route to check.");
    return base;
  }
  if (entry === null || stop === null || target === null) {
    findings.push("Plan is missing an entry, stop or target price, so reward/risk cannot be bounded.");
    return base;
  }
  const long = direction === "LONG";
  const levelsValid = long ? stop < entry && target > entry : stop > entry && target < entry;
  if (!levelsValid) {
    findings.push(`Levels are on the wrong side of entry for a ${direction}: stop ${stop}, entry ${entry}, target ${target}.`);
  }
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const rewardRisk = risk > 0 ? round(reward / risk, 2) : null;
  const stopAtr = atr && atr > 0 ? round(risk / atr, 2) : null;
  const trend = features?.candles?.trend ?? null;
  const trendAligned = trend === null ? null : trend === "SIDEWAYS" ? null : (trend === "UP") === long;
  const bias = features?.depth?.bias ?? null;
  const depthAligned = bias === null || bias === "BALANCED" ? null : (bias === "BID_HEAVY") === long;

  if (rewardRisk !== null) findings.push(`Reward/risk ${rewardRisk} (minimum ${budget.minRewardRisk} for this risk posture).`);
  if (stopAtr !== null) findings.push(`Stop sits ${stopAtr} ATR from entry (maximum ${budget.maxStopAtr}).`);
  if (stopAtr !== null && stopAtr < 0.4) findings.push("Stop is inside normal bar noise (< 0.4 ATR) and likely to be hit by chance.");
  const targetAtr = atr && atr > 0 ? round(reward / atr, 2) : null;
  const targetReachable = targetAtr === null || targetAtr <= MAX_REACHABLE_TARGET_ATR;
  if (targetAtr !== null) {
    findings.push(targetReachable
      ? `Target needs a ${targetAtr} ATR move, reachable within the horizon.`
      : `Target needs a ${targetAtr} ATR move, unlikely within a one-bar horizon.`);
  }
  if (trendAligned === true) findings.push(`Direction agrees with the measured ${trend} trend.`);
  if (trendAligned === false) findings.push(`Direction fights the measured ${trend} trend.`);
  if (depthAligned === false) findings.push(`Order book is ${bias}, against this direction.`);

  const withinRiskBudget = levelsValid && targetReachable
    && rewardRisk !== null && rewardRisk >= budget.minRewardRisk
    && (stopAtr === null || (stopAtr >= 0.4 && stopAtr <= budget.maxStopAtr));

  return {
    ...base,
    riskPct: round((risk / entry) * 100),
    rewardPct: round((reward / entry) * 100),
    rewardRisk, stopAtr, levelsValid, trendAligned, depthAligned, withinRiskBudget,
  };
}

// A judge's better level only counts if it passes the same standard as any plan
// and is a real alternative to entering now: at least 0.3 ATR from the last
// price (otherwise it is the current price), and no more than 1.5 ATR away
// (otherwise it is not reachable within the horizon).
export function checkBetterLevel(
  submission: CaseSubmission,
  level: BetterLevel,
): { valid: boolean; problems: string[]; route: RouteCheck } {
  const features = marketFeaturesOf(submission);
  const budget = riskBudgets[submission.riskLevel];
  const route = checkRoute(level.direction, {
    entry: level.entryPrice, stop: level.stopPrice, target: level.targetPrice,
  }, features, budget);
  const problems: string[] = [...planStandard(route).failures];
  const atr = features?.candles?.atr ?? null;
  if (!features || !atr || atr <= 0) {
    problems.push("no measured volatility to place the level against");
  } else {
    const distance = Math.abs(level.entryPrice - features.lastPrice) / atr;
    if (distance < 0.3) problems.push("entry is within 0.3 ATR of the current price, so it is not a different level");
    if (distance > 1.5) problems.push("entry is more than 1.5 ATR from the current price, too far to wait for within this horizon");
  }
  return { valid: problems.length === 0, problems, route };
}

export type PlanStandard = {
  status: "MEETS_STANDARD" | "FAILS_STANDARD" | "NO_TRADE";
  // What failed, from the computed checks.
  failures: string[];
  // Soft factors that lower confidence but are not grounds to reject alone.
  cautions: string[];
};

// The court's measured standard for opening a position, computed in code so a
// judge cannot invent a stricter one: valid levels, within the risk budget and
// not fighting the measured trend. Depth against the direction is a caution.
// Live judges rejected clean, budget-compliant trend plans for "weak momentum".
export function planStandard(route: RouteCheck | null | undefined): PlanStandard {
  if (!route || route.direction === "NEUTRAL") return { status: "NO_TRADE", failures: [], cautions: [] };
  const failures: string[] = [];
  const cautions: string[] = [];
  if (!route.levelsValid) failures.push("levels are missing or on the wrong side of entry");
  if (!route.withinRiskBudget) failures.push("reward/risk, stop distance or target reach is outside the risk budget");
  if (route.trendAligned === false) failures.push("direction fights the measured trend");
  if (route.depthAligned === false) cautions.push("order book leans against this direction");
  return { status: failures.length ? "FAILS_STANDARD" : "MEETS_STANDARD", failures, cautions };
}

export type ReferencePlan = {
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rewardRisk: number;
  stopAtr: number;
  // Distance from entry to target in ATR, so reachability is a number rather
  // than a label the models can misread.
  targetAtr: number;
  // STRUCTURAL is the correct placement: just beyond the recent swing, inside
  // the budget. INSIDE_RANGE means the structural stop was too far for this
  // horizon's budget, so the stop was pulled inside the range. These are labels
  // rather than booleans: live judges and both researchers read a
  // `stopBeyondSwing: true` flag as a violation even beside a note saying it
  // was the correct placement.
  stopPlacement: "STRUCTURAL" | "INSIDE_RANGE";
  // Plain-language reading of the levels.
  note: string;
};

// A budget-compliant plan per side sized to one horizon bar: stop just beyond
// the nearest recent extreme, clamped to 0.5..maxStopAtr ATR, target at the
// posture's minimum reward/risk. Live runs showed the model placing targets
// far too close (reward/risk 0.3-1.4), and a first version of this plan placed
// them nearly 3 ATR out, which judges rightly called unreachable in one bar.
export function referencePlans(
  features: MarketFeatures | null,
  riskLevel: CaseSubmission["riskLevel"],
): { LONG: ReferencePlan; SHORT: ReferencePlan } | null {
  const candles = features?.candles;
  if (!features || !candles?.atr || candles.atr <= 0) return null;
  const budget = riskBudgets[riskLevel];
  const atr = candles.atr;
  const entry = features.lastPrice;
  const precision = entry >= 100 ? 2 : 4;
  const fix = (value: number) => Number(value.toFixed(precision));
  const plan = (direction: "LONG" | "SHORT"): ReferencePlan => {
    const long = direction === "LONG";
    const swingDistance = long ? entry - candles.recentLow : candles.recentHigh - entry;
    const structuralStop = Math.max(0.5 * atr, swingDistance + 0.1 * atr);
    // Largest stop whose minimum-R target is still reachable in the horizon.
    const rewardMultiple = budget.minRewardRisk * 1.05;
    const maxRisk = Math.min(budget.maxStopAtr, MAX_REACHABLE_TARGET_ATR / rewardMultiple) * atr;
    const riskDistance = Math.min(maxRisk, structuralStop);
    const rewardDistance = riskDistance * rewardMultiple;
    const stop = fix(long ? entry - riskDistance : entry + riskDistance);
    const target = fix(long ? entry + rewardDistance : entry - rewardDistance);
    const swingLevel = fix(long ? candles.recentLow : candles.recentHigh);
    const stopBeyondSwing = structuralStop <= maxRisk;
    const targetBeyondSwing = long ? target > candles.swingHigh : target < candles.swingLow;
    const note = [
      stopBeyondSwing
        ? `Stop ${stop} sits just ${long ? "below" : "above"} the recent swing ${long ? "low" : "high"} ${swingLevel}, the correct structural place for a ${direction} stop.`
        : `The structural stop beyond the recent swing ${long ? "low" : "high"} ${swingLevel} is too far for this horizon's budget, so stop ${stop} sits inside the recent range and is more exposed to noise.`,
      targetBeyondSwing
        ? `Target ${target} is ${round(rewardDistance / atr, 2)} ATR from entry and beyond the window's swing ${long ? "high" : "low"}, so reaching it needs a breakout.`
        : `Target ${target} is ${round(rewardDistance / atr, 2)} ATR from entry, within one-bar reach.`,
    ].join(" ");
    return {
      direction,
      entryPrice: fix(entry),
      stopPrice: stop,
      targetPrice: target,
      rewardRisk: round(Math.abs(target - entry) / Math.abs(entry - stop), 2),
      stopAtr: round(riskDistance / atr, 2),
      targetAtr: round(rewardDistance / atr, 2),
      stopPlacement: stopBeyondSwing ? "STRUCTURAL" : "INSIDE_RANGE",
      note,
    };
  };
  return { LONG: plan("LONG"), SHORT: plan("SHORT") };
}

export function computeRiskCheck(submission: CaseSubmission, analystCase: AnalystCase): RiskCheck {
  const features = marketFeaturesOf(submission);
  const budget = riskBudgets[submission.riskLevel];
  const alternative = analystCase.alternativeRoute;
  return {
    riskLevel: submission.riskLevel,
    budget: { ...budget, maxTargetAtr: MAX_REACHABLE_TARGET_ATR },
    lastPrice: features?.lastPrice ?? null,
    trend: features?.candles?.trend ?? null,
    depthBias: features?.depth?.bias ?? null,
    referencePlans: referencePlans(features, submission.riskLevel),
    primary: checkRoute(analystCase.marketBias, {
      entry: analystCase.entryPrice, stop: analystCase.stopPrice, target: analystCase.targetPrice,
    }, features, budget),
    alternative: alternative.direction === "NEUTRAL"
      ? null
      : checkRoute(alternative.direction, {
        entry: alternative.entryPrice, stop: alternative.stopPrice, target: alternative.targetPrice,
      }, features, budget),
  };
}
