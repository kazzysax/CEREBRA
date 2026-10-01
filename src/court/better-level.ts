import type { BetterLevel, JudgeId } from "../domain/contracts.js";

export type BetterLevelAdvice = {
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  rewardRisk: number;
  lastPrice: number;
  judges: JudgeId[];
  reasons: string[];
  instruction: string;
  disclaimer: string;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

// Optional advice, never required: a better level is only offered when at least
// two judges, each already validated against the risk budget, propose the same
// side at entries within half an ATR of each other. A single judge's idea, or
// proposals that disagree, produce nothing.
export function consensusBetterLevel(
  proposals: Array<{ judgeId: JudgeId; level: BetterLevel }>,
  context: { atr: number; lastPrice: number },
): BetterLevelAdvice | null {
  for (const direction of ["LONG", "SHORT"] as const) {
    const side = proposals.filter((item) => item.level.direction === direction);
    if (side.length < 2) continue;
    const centre = median(side.map((item) => item.level.entryPrice));
    const agreeing = side.filter((item) => Math.abs(item.level.entryPrice - centre) <= 0.5 * context.atr);
    if (agreeing.length < 2) continue;
    const precision = context.lastPrice >= 100 ? 2 : 4;
    const fix = (value: number) => Number(value.toFixed(precision));
    const entry = fix(median(agreeing.map((item) => item.level.entryPrice)));
    const stop = fix(median(agreeing.map((item) => item.level.stopPrice)));
    const target = fix(median(agreeing.map((item) => item.level.targetPrice)));
    const risk = Math.abs(entry - stop);
    if (risk === 0) continue;
    const rewardRisk = Number((Math.abs(target - entry) / risk).toFixed(2));
    return {
      direction,
      entryPrice: entry,
      stopPrice: stop,
      targetPrice: target,
      rewardRisk,
      lastPrice: fix(context.lastPrice),
      judges: agreeing.map((item) => item.judgeId),
      reasons: agreeing.map((item) => item.level.reason),
      instruction: `Optional: a better ${direction} entry is near ${entry} (price is ${fix(context.lastPrice)} now). Waiting for it is advised only if price comes to that level; do not chase at the current price.`,
      disclaimer: "Advisory only and not required. Levels are re-checked against the risk budget; confirm at execution time.",
    };
  }
  return null;
}
