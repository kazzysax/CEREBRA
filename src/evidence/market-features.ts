// Deterministic market features computed from raw Bitget ticker, order-book and
// candle payloads. Models are poor at arithmetic over raw JSON arrays, so the
// court is handed these measured facts (trend, returns, volatility, depth
// imbalance, key levels) instead of being asked to derive them itself.

export type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketFeatures = {
  symbol: string;
  interval: string;
  observedAt: string;
  lastPrice: number;
  change24hPct: number | null;
  range24h: { high: number; low: number; positionPct: number } | null;
  spreadBps: number | null;
  depth: { bidNotional: number; askNotional: number; imbalance: number; bias: "BID_HEAVY" | "ASK_HEAVY" | "BALANCED" } | null;
  fundingRatePct: number | null;
  candles: {
    count: number;
    newestAt: string;
    returnsPct: { last1: number | null; last3: number | null; last6: number | null; last12: number | null; all: number | null };
    smaShort: number | null;
    smaLong: number | null;
    priceVsSmaShortPct: number | null;
    priceVsSmaLongPct: number | null;
    atr: number | null;
    atrPct: number | null;
    trend: "UP" | "DOWN" | "SIDEWAYS";
    trendEvidence: string;
    swingHigh: number;
    swingLow: number;
    recentHigh: number;
    recentLow: number;
    volumeRatio: number | null;
  } | null;
};

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(from: number, to: number): number {
  return round(((to - from) / from) * 100, 3);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// Bitget returns candles as [ts, open, high, low, close, baseVolume, quoteVolume],
// oldest first. Normalize to typed rows sorted oldest -> newest.
export function parseCandles(data: unknown): Candle[] {
  if (!Array.isArray(data)) return [];
  const rows: Candle[] = [];
  for (const row of data) {
    const values = Array.isArray(row)
      ? row
      : row && typeof row === "object"
      ? [
        (row as Record<string, unknown>).ts,
        (row as Record<string, unknown>).open,
        (row as Record<string, unknown>).high,
        (row as Record<string, unknown>).low,
        (row as Record<string, unknown>).close,
        (row as Record<string, unknown>).volume ?? (row as Record<string, unknown>).baseVolume,
      ]
      : [];
    const [ts, open, high, low, close, volume] = values.map(num);
    if (ts === null || ts === undefined || open == null || high == null || low == null || close == null) continue;
    rows.push({ ts, open, high, low, close, volume: volume ?? 0 });
  }
  return rows.sort((left, right) => left.ts - right.ts);
}

function firstTicker(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return (data[0] as Record<string, unknown> | undefined) ?? null;
  return data && typeof data === "object" ? data as Record<string, unknown> : null;
}

function bookSide(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((level) => {
    if (!Array.isArray(level)) return [];
    const price = num(level[0]);
    const size = num(level[1]);
    return price !== null && size !== null ? [[price, size] as [number, number]] : [];
  });
}

function candleFeatures(candles: Candle[], lastPrice: number): MarketFeatures["candles"] {
  if (candles.length < 3) return null;
  const closes = candles.map((candle) => candle.close);
  const newest = candles.at(-1)!;
  const back = (bars: number) => candles.length > bars ? pct(candles.at(-1 - bars)!.close, newest.close) : null;
  const shortWindow = Math.min(6, candles.length);
  const smaShort = mean(closes.slice(-shortWindow));
  const smaLong = mean(closes);

  const trueRanges = candles.slice(1).map((candle, index) => {
    const previousClose = candles[index]!.close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  const atrWindow = trueRanges.slice(-14);
  const atr = atrWindow.length ? mean(atrWindow) : null;

  // Trend: agreement between the short/long average slope and the last swing
  // structure (higher highs and higher lows, or the reverse).
  const half = Math.floor(candles.length / 2);
  const early = candles.slice(0, half);
  const late = candles.slice(half);
  const earlyHigh = Math.max(...early.map((candle) => candle.high));
  const earlyLow = Math.min(...early.map((candle) => candle.low));
  const lateHigh = Math.max(...late.map((candle) => candle.high));
  const lateLow = Math.min(...late.map((candle) => candle.low));
  const higherStructure = lateHigh > earlyHigh && lateLow > earlyLow;
  const lowerStructure = lateHigh < earlyHigh && lateLow < earlyLow;
  const smaSpreadPct = pct(smaLong, smaShort);
  const noise = atr ? (atr / newest.close) * 100 * 0.5 : 0.1;
  let trend: "UP" | "DOWN" | "SIDEWAYS" = "SIDEWAYS";
  if (smaSpreadPct > noise && (higherStructure || lastPrice > smaShort)) trend = "UP";
  else if (smaSpreadPct < -noise && (lowerStructure || lastPrice < smaShort)) trend = "DOWN";
  const trendEvidence = `short SMA ${round(smaShort, 2)} vs long SMA ${round(smaLong, 2)} (${smaSpreadPct}%), ` +
    `structure ${higherStructure ? "higher highs + higher lows" : lowerStructure ? "lower highs + lower lows" : "mixed"}`;

  const recent = candles.slice(-5);
  const volumes = candles.map((candle) => candle.volume);
  const recentVolume = mean(volumes.slice(-shortWindow));
  const priorVolumes = volumes.slice(0, -shortWindow);
  const volumeRatio = priorVolumes.length && mean(priorVolumes) > 0 ? round(recentVolume / mean(priorVolumes), 2) : null;

  return {
    count: candles.length,
    newestAt: new Date(newest.ts).toISOString(),
    returnsPct: { last1: back(1), last3: back(3), last6: back(6), last12: back(12), all: pct(candles[0]!.open, newest.close) },
    smaShort: round(smaShort, 4),
    smaLong: round(smaLong, 4),
    priceVsSmaShortPct: pct(smaShort, lastPrice),
    priceVsSmaLongPct: pct(smaLong, lastPrice),
    atr: atr === null ? null : round(atr, 4),
    atrPct: atr === null ? null : round((atr / lastPrice) * 100, 3),
    trend,
    trendEvidence,
    swingHigh: Math.max(...candles.map((candle) => candle.high)),
    swingLow: Math.min(...candles.map((candle) => candle.low)),
    recentHigh: Math.max(...recent.map((candle) => candle.high)),
    recentLow: Math.min(...recent.map((candle) => candle.low)),
    volumeRatio,
  };
}

export function computeMarketFeatures(input: {
  symbol: string;
  interval: string;
  observedAt: string;
  ticker: unknown;
  orderbook: unknown;
  candles: unknown;
}): MarketFeatures {
  const ticker = firstTicker(input.ticker);
  const candles = parseCandles(input.candles);
  const lastPrice = num(ticker?.lastPrice) ?? candles.at(-1)?.close ?? 0;
  const open24h = num(ticker?.openPrice24h);
  const high24h = num(ticker?.highPrice24h);
  const low24h = num(ticker?.lowPrice24h);
  const bid1 = num(ticker?.bid1Price);
  const ask1 = num(ticker?.ask1Price);
  const funding = num(ticker?.fundingRate);

  const book = input.orderbook && typeof input.orderbook === "object" ? input.orderbook as Record<string, unknown> : {};
  const bids = bookSide(book.b ?? book.bids);
  const asks = bookSide(book.a ?? book.asks);
  const bidNotional = bids.reduce((sum, [price, size]) => sum + price * size, 0);
  const askNotional = asks.reduce((sum, [price, size]) => sum + price * size, 0);
  const totalNotional = bidNotional + askNotional;
  const imbalance = totalNotional > 0 ? round((bidNotional - askNotional) / totalNotional, 3) : 0;

  return {
    symbol: input.symbol,
    interval: input.interval,
    observedAt: input.observedAt,
    lastPrice,
    change24hPct: open24h ? pct(open24h, lastPrice) : null,
    range24h: high24h !== null && low24h !== null && high24h > low24h
      ? { high: high24h, low: low24h, positionPct: round(((lastPrice - low24h) / (high24h - low24h)) * 100, 1) }
      : null,
    spreadBps: bid1 && ask1 ? round(((ask1 - bid1) / ((ask1 + bid1) / 2)) * 10_000, 2) : null,
    depth: totalNotional > 0
      ? {
        bidNotional: round(bidNotional, 2),
        askNotional: round(askNotional, 2),
        imbalance,
        bias: imbalance > 0.15 ? "BID_HEAVY" : imbalance < -0.15 ? "ASK_HEAVY" : "BALANCED",
      }
      : null,
    fundingRatePct: funding === null ? null : round(funding * 100, 4),
    candles: candleFeatures(candles, lastPrice),
  };
}

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "4h": 14_400_000, "6h": 21_600_000, "12h": 43_200_000, "1d": 86_400_000,
};

// How old the newest candle is at the snapshot. A bar opened within one
// interval is the live bar; more than two intervals means the feed stalled or
// the market is closed, and the data should not be read as current.
export function intervalMs(interval: string): number | null {
  return INTERVAL_MS[interval.trim().toLowerCase()] ?? null;
}

export function dataFreshness(newestAt: string, observedAt: string, interval: string): { ageMinutes: number; stale: boolean } | null {
  const barMs = INTERVAL_MS[interval.toLowerCase()];
  const age = new Date(observedAt).getTime() - new Date(newestAt).getTime();
  if (!barMs || !Number.isFinite(age)) return null;
  return { ageMinutes: Math.max(0, Math.round(age / 60_000)), stale: age > 2 * barMs };
}

export function renderFeatureSummary(features: MarketFeatures): string {
  const lines = [
    `Measured market features for ${features.symbol} (${features.interval} candles), computed by Cerebra from the Bitget snapshot at ${features.observedAt}.`,
    `Last price ${features.lastPrice}; 24h change ${features.change24hPct ?? "n/a"}%.`,
  ];
  if (features.range24h) {
    lines.push(`24h range ${features.range24h.low} - ${features.range24h.high}; price sits at ${features.range24h.positionPct}% of that range.`);
  }
  if (features.spreadBps !== null) lines.push(`Bid/ask spread ${features.spreadBps} bps.`);
  if (features.depth) {
    lines.push(`Top-of-book depth: bids ${features.depth.bidNotional} vs asks ${features.depth.askNotional} (USDT notional), imbalance ${features.depth.imbalance} -> ${features.depth.bias}.`);
  }
  if (features.fundingRatePct !== null) lines.push(`Funding rate ${features.fundingRatePct}% per interval (positive = longs pay shorts).`);
  const c = features.candles;
  if (c) {
    lines.push(
      `Candles: ${c.count} bars, newest opened ${c.newestAt}.`,
      ...(() => {
        const fresh = dataFreshness(c.newestAt, features.observedAt, features.interval);
        if (!fresh) return [];
        return [fresh.stale
          ? `DATA FRESHNESS: STALE. The newest bar opened ${fresh.ageMinutes} minutes before this snapshot, more than two ${features.interval} bars; the market may be closed or the feed stalled, so do not treat this as a current read.`
          : `Data freshness: current (newest bar opened ${fresh.ageMinutes} minutes before this snapshot).`];
      })(),
      `Trend classification: ${c.trend} (${c.trendEvidence}).`,
      `Returns: last bar ${c.returnsPct.last1 ?? "n/a"}%, last 3 bars ${c.returnsPct.last3 ?? "n/a"}%, last 6 bars ${c.returnsPct.last6 ?? "n/a"}%, last 12 bars ${c.returnsPct.last12 ?? "n/a"}%, whole window ${c.returnsPct.all ?? "n/a"}%.`,
      `Price vs short SMA ${c.priceVsSmaShortPct ?? "n/a"}%, vs long SMA ${c.priceVsSmaLongPct ?? "n/a"}%.`,
      `Average true range ${c.atr ?? "n/a"} (${c.atrPct ?? "n/a"}% of price) per bar.`,
      `Key levels: recent (last 5 bars) high ${c.recentHigh} / low ${c.recentLow}; window swing high ${c.swingHigh} / swing low ${c.swingLow}.`,
      `Volume: recent bars run at ${c.volumeRatio ?? "n/a"}x the earlier average.`,
    );
  }
  return lines.join("\n");
}

// Newest-first compact candle table so a size cap can never hide the most
// recent price action (the previous oldest-first JSON lost the newest bars).
export function renderCandleTable(candles: Candle[], maxRows = 24): string {
  const rows = [...candles].reverse().slice(0, maxRows).map((candle) =>
    [new Date(candle.ts).toISOString().slice(0, 16), candle.open, candle.high, candle.low, candle.close, round(candle.volume, 2)].join(","),
  );
  return "Newest first. time(UTC),open,high,low,close,volume\n" + rows.join("\n");
}
