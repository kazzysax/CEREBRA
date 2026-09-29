import { randomUUID } from "node:crypto";
import type { AnalystCase } from "../agents/contracts.js";
import type { EvidenceProvider } from "../evidence/contracts.js";
import type { Candle, MarketFeatures } from "../evidence/market-features.js";
import type { CaseRepository } from "../storage/contracts.js";
import type { AwaitingOutcome, OutcomeRecord } from "./contracts.js";

// Closes the post-trade loop without waiting for an agent to report back: once
// a ruling's horizon has elapsed, replay the price path after the ruling
// against the plan's stop and target and record what actually happened.

const horizons: Record<string, { ms: number; interval: string; label: OutcomeRecord["horizon"] }> = {
  "15m": { ms: 15 * 60_000, interval: "1m", label: "15m" },
  "1h": { ms: 3_600_000, interval: "5m", label: "1h" },
  "4h": { ms: 4 * 3_600_000, interval: "15m", label: "4h" },
  "1d": { ms: 24 * 3_600_000, interval: "1H", label: "24h" },
};
// Bitget serves recent candle history; past this the price path is not reliably available.
const MAX_AGE_MS = 25 * 24 * 3_600_000;

export function horizonFor(timeframe: string) {
  return horizons[timeframe.trim().toLowerCase()] ?? horizons["4h"]!;
}

type RunResultShape = {
  analystCase?: AnalystCase;
  report?: { evidence?: Array<{ metrics?: Record<string, unknown> }> };
};

export type Resolution = {
  thesisOutcome: OutcomeRecord["thesisOutcome"];
  realizedReturnPct: number | null;
  note: string;
};

// Pure: decide an outcome from a direction, levels and the candles after the ruling.
export function resolvePath(input: {
  direction: "LONG" | "SHORT";
  entry: number;
  stop: number;
  target: number;
  atrPct: number | null;
  candles: Candle[];
}): Resolution {
  const { direction, entry, stop, target, candles } = input;
  const long = direction === "LONG";
  if (!candles.length) return { thesisOutcome: "INCONCLUSIVE", realizedReturnPct: null, note: "No price data after the ruling." };
  for (const candle of candles) {
    const hitStop = long ? candle.low <= stop : candle.high >= stop;
    const hitTarget = long ? candle.high >= target : candle.low <= target;
    // When one bar spans both levels the order is unknowable; count it against the thesis.
    if (hitStop) {
      return { thesisOutcome: "REFUTED", realizedReturnPct: round(((stop - entry) / entry) * 100 * (long ? 1 : -1)), note: `Stop ${stop} hit at ${new Date(candle.ts).toISOString()}.` };
    }
    if (hitTarget) {
      return { thesisOutcome: "CONFIRMED", realizedReturnPct: round(((target - entry) / entry) * 100 * (long ? 1 : -1)), note: `Target ${target} hit at ${new Date(candle.ts).toISOString()}.` };
    }
  }
  const close = candles.at(-1)!.close;
  const returnPct = round(((close - entry) / entry) * 100 * (long ? 1 : -1));
  // Neither level touched: judge the drift against a quarter of one bar's typical range.
  const threshold = Math.max(0.1, (input.atrPct ?? 0.4) * 0.25);
  const thesisOutcome = returnPct > threshold ? "CONFIRMED" : returnPct < -threshold ? "REFUTED" : "INCONCLUSIVE";
  return { thesisOutcome, realizedReturnPct: returnPct, note: `Neither stop nor target hit; ${returnPct}% in the thesis direction at horizon end (threshold ±${round(threshold)}%).` };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function featuresOf(result: RunResultShape): MarketFeatures | null {
  const item = result.report?.evidence?.find((entry) => entry.metrics && typeof entry.metrics.lastPrice === "number");
  return (item?.metrics as MarketFeatures | undefined) ?? null;
}

export async function resolveRun(
  run: AwaitingOutcome,
  evidenceProvider: EvidenceProvider,
  now: Date,
): Promise<Resolution> {
  const result = (run.result ?? {}) as RunResultShape;
  const analyst = result.analystCase;
  const horizon = horizonFor(run.timeframe);
  const direction = analyst?.marketBias;
  if (!analyst || direction === undefined || direction === "NEUTRAL") {
    return { thesisOutcome: "INCONCLUSIVE", realizedReturnPct: null, note: "No directional thesis to resolve." };
  }
  const features = featuresOf(result);
  const entry = analyst.entryPrice ?? features?.lastPrice ?? null;
  const atr = features?.candles?.atr ?? null;
  if (entry === null) {
    return { thesisOutcome: "INCONCLUSIVE", realizedReturnPct: null, note: "No entry price was recorded for this ruling." };
  }
  const sign = direction === "LONG" ? 1 : -1;
  const stop = analyst.stopPrice ?? (atr ? entry - sign * 0.75 * atr : entry * (1 - sign * 0.01));
  const target = analyst.targetPrice ?? (atr ? entry + sign * 1.5 * atr : entry * (1 + sign * 0.02));
  const startMs = new Date(run.completedAt).getTime();
  if (now.getTime() - startMs > MAX_AGE_MS || !evidenceProvider.priceHistory) {
    return { thesisOutcome: "INCONCLUSIVE", realizedReturnPct: null, note: "Price history for this window is no longer available." };
  }
  const candles = await evidenceProvider.priceHistory({
    asset: run.asset,
    market: run.market,
    interval: horizon.interval,
    startMs,
    endMs: startMs + horizon.ms,
  });
  return resolvePath({ direction, entry, stop, target, atrPct: features?.candles?.atrPct ?? null, candles });
}

export async function resolveDueOutcomes(options: {
  repository: CaseRepository;
  evidenceProvider: EvidenceProvider;
  now?: (() => Date) | undefined;
  limit?: number | undefined;
  log?: ((message: string, detail?: unknown) => void) | undefined;
}): Promise<number> {
  const now = options.now?.() ?? new Date();
  // Shortest horizon is 15 minutes; per-run due time is checked below.
  const candidates = await options.repository.listRunsAwaitingOutcome(
    new Date(now.getTime() - 15 * 60_000).toISOString(),
    options.limit ?? 25,
  );
  let recorded = 0;
  for (const run of candidates) {
    const horizon = horizonFor(run.timeframe);
    if (new Date(run.completedAt).getTime() + horizon.ms > now.getTime()) continue;
    try {
      const resolution = await resolveRun(run, options.evidenceProvider, now);
      await options.repository.saveOutcome({
        id: randomUUID(),
        runId: run.runId,
        agentId: run.agentId,
        source: "AUTO",
        horizon: horizon.label,
        thesisOutcome: resolution.thesisOutcome,
        ...(resolution.realizedReturnPct === null ? {} : { realizedReturnPct: resolution.realizedReturnPct }),
        note: resolution.note,
        observedAt: new Date(Math.min(now.getTime(), new Date(run.completedAt).getTime() + horizon.ms)).toISOString(),
        recordedAt: now.toISOString(),
      });
      recorded += 1;
    } catch (error) {
      // Leave the run unresolved; the next sweep retries it.
      options.log?.("outcome resolution failed", { runId: run.runId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return recorded;
}

export function createOutcomeResolverLoop(options: {
  repository: CaseRepository;
  evidenceProvider: EvidenceProvider;
  intervalMs?: number | undefined;
  log?: ((message: string, detail?: unknown) => void) | undefined;
}) {
  const intervalMs = options.intervalMs ?? 5 * 60_000;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<unknown> | null = null;
  const tick = () => {
    if (running) return;
    running = resolveDueOutcomes(options)
      .catch((error) => options.log?.("outcome sweep failed", error instanceof Error ? error.message : error))
      .finally(() => { running = null; });
  };
  return {
    start() { if (timer) return; timer = setInterval(tick, intervalMs); tick(); },
    async stop() { if (timer) clearInterval(timer); timer = null; if (running) await running; },
  };
}
