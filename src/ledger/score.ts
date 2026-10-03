import type { EvidenceProvider } from "../evidence/contracts.js";
import { horizonFor, resolvePath } from "../outcomes/auto-resolver.js";
import type { LedgerEntry, LedgerRepository, LedgerScore } from "./contracts.js";

// Bitget serves recent candle history only; beyond this the path is gone.
const MAX_AGE_MS = 25 * 24 * 3_600_000;
// Candles for the last minutes of the horizon may not be final yet.
const SETTLE_MS = 60_000;

type ReportShape = {
  recommendation?: { status?: string; direction?: string; entryPrice?: number | null; stopPrice?: number | null; targetPrice?: number | null };
  riskCheck?: { primary?: { direction?: string; entry?: number | null; stop?: number | null; target?: number | null } } | null;
  evidence?: Array<{ metrics?: { candles?: { atrPct?: number | null } } }>;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function notScorable(horizon: string, note: string, now: Date): LedgerScore {
  return {
    kind: "NOT_SCORABLE", result: "NOT_SCORABLE", thesisOutcome: null, direction: null,
    entryPrice: null, stopPrice: null, targetPrice: null, realizedReturnPct: null,
    horizon, note, resolvedAt: now.toISOString(),
  };
}

// One score per ruling: the court's recommended trade when it issued one,
// otherwise the plan it declined (a counterfactual, so a rejection that missed
// a winner is recorded as a miss). Rulings with no directional plan at all are
// marked not scorable rather than counted as right.
// Returns null while the horizon is still open or price history is unavailable,
// so the next sweep retries.
export async function scoreEntry(
  entry: LedgerEntry,
  reportValue: unknown,
  evidenceProvider: EvidenceProvider,
  now: Date,
): Promise<LedgerScore | null> {
  const report = reportValue as ReportShape;
  const horizon = horizonFor(entry.timeframe ?? "4h");
  const startMs = new Date(entry.ruledAt).getTime();
  if (startMs + horizon.ms + SETTLE_MS > now.getTime()) return null;

  const recommendation = report.recommendation;
  const primary = report.riskCheck?.primary;
  let kind: "SIGNAL" | "REJECTION";
  let direction: "LONG" | "SHORT";
  let entryPrice: number;
  let stopPrice: number;
  let targetPrice: number;
  if (
    recommendation?.status === "ACTIONABLE" && (recommendation.direction === "LONG" || recommendation.direction === "SHORT")
    && finite(recommendation.entryPrice) && finite(recommendation.stopPrice) && finite(recommendation.targetPrice)
  ) {
    kind = "SIGNAL";
    direction = recommendation.direction;
    entryPrice = recommendation.entryPrice;
    stopPrice = recommendation.stopPrice;
    targetPrice = recommendation.targetPrice;
  } else if (
    primary && (primary.direction === "LONG" || primary.direction === "SHORT")
    && finite(primary.entry) && finite(primary.stop) && finite(primary.target)
  ) {
    kind = "REJECTION";
    direction = primary.direction;
    entryPrice = primary.entry;
    stopPrice = primary.stop;
    targetPrice = primary.target;
  } else {
    return notScorable(horizon.label, "The court backed no directional plan and the Analyst proposed none, so there is nothing to check against the market.", now);
  }

  if (now.getTime() - startMs > MAX_AGE_MS || !evidenceProvider.priceHistory) {
    return notScorable(horizon.label, "Price history for this window is no longer available.", now);
  }
  const candles = await evidenceProvider.priceHistory({
    asset: entry.asset ?? "",
    market: "usdt-futures",
    interval: horizon.interval,
    startMs,
    endMs: startMs + horizon.ms,
  });
  if (!candles.length) return null;
  const atrPct = report.evidence?.map((item) => item.metrics?.candles?.atrPct).find(finite) ?? null;
  const resolution = resolvePath({ direction, entry: entryPrice, stop: stopPrice, target: targetPrice, atrPct, candles });
  const result: LedgerScore["result"] = kind === "SIGNAL"
    ? resolution.thesisOutcome === "CONFIRMED" ? "WIN" : resolution.thesisOutcome === "REFUTED" ? "LOSS" : "FLAT"
    : resolution.thesisOutcome === "REFUTED" ? "REJECTION_CORRECT" : resolution.thesisOutcome === "CONFIRMED" ? "REJECTION_MISSED" : "FLAT";
  const basis: LedgerScore["basis"] = /^Target /.test(resolution.note) ? "TARGET" : /^Stop /.test(resolution.note) ? "STOP" : resolution.thesisOutcome === "INCONCLUSIVE" ? null : "DRIFT";
  return {
    kind, result, thesisOutcome: resolution.thesisOutcome, basis, direction,
    entryPrice, stopPrice, targetPrice, realizedReturnPct: resolution.realizedReturnPct,
    horizon: horizon.label,
    note: (kind === "REJECTION" ? "Counterfactual on the plan the court declined. " : "") + resolution.note,
    resolvedAt: now.toISOString(),
  };
}

export function createLedgerScorerLoop(options: {
  ledger: LedgerRepository;
  evidenceProvider: EvidenceProvider;
  intervalMs?: number | undefined;
  now?: (() => Date) | undefined;
  log?: ((message: string, detail?: unknown) => void) | undefined;
}) {
  const intervalMs = options.intervalMs ?? 5 * 60_000;
  let timer: NodeJS.Timeout | null = null;
  let running: Promise<unknown> | null = null;
  const sweep = async () => {
    const now = options.now?.() ?? new Date();
    for (const { entry, report } of await options.ledger.listUnscored(25)) {
      try {
        const score = await scoreEntry(entry, report, options.evidenceProvider, now);
        if (score) await options.ledger.setScore(entry.seq, score);
      } catch (error) {
        options.log?.("ledger scoring failed", { seq: entry.seq, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  const tick = () => {
    if (running) return;
    running = sweep()
      .catch((error) => options.log?.("ledger sweep failed", error instanceof Error ? error.message : error))
      .finally(() => { running = null; });
  };
  return {
    sweep,
    start() { if (timer) return; timer = setInterval(tick, intervalMs); tick(); },
    async stop() { if (timer) clearInterval(timer); timer = null; if (running) await running; },
  };
}
