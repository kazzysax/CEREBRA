import { createHash } from "node:crypto";
import type { EvidenceProvider } from "./contracts.js";
import { computeMarketFeatures, renderCandleTable, renderFeatureSummary, type Candle } from "./market-features.js";

// Seeded pseudo-random walk so development runs see realistic, asset-specific
// (and therefore varied) market structure instead of one fixed snapshot.
function seededRandom(seed: string) {
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0) || 1;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
}

const intervalMs: Record<string, number> = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000 };

export function syntheticCandles(asset: string, timeframe: string, endMs: number, count = 48): Candle[] {
  const step = intervalMs[timeframe.toLowerCase()] ?? 3_600_000;
  const random = seededRandom(asset.toUpperCase() + ":" + timeframe + ":" + Math.floor(endMs / (step * 6)));
  const drift = (random() - 0.5) * 0.006;
  let price = 50 + random() * 400;
  const candles: Candle[] = [];
  const start = Math.floor(endMs / step) * step - (count - 1) * step;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    const close = open * (1 + drift + (random() - 0.5) * 0.012);
    const high = Math.max(open, close) * (1 + random() * 0.004);
    const low = Math.min(open, close) * (1 - random() * 0.004);
    candles.push({ ts: start + index * step, open, high, low, close, volume: 100 + random() * 900 });
    price = close;
  }
  return candles;
}

export function createMockEvidenceProvider(
  now: () => Date = () => new Date(),
): EvidenceProvider {
  return {
    name: "mock-market-evidence",
    async collect(request) {
      const observedAt = now().toISOString();
      const symbol = request.asset.toUpperCase();
      const candles = syntheticCandles(symbol, request.timeframe, now().getTime());
      const last = candles.at(-1)!;
      const random = seededRandom(symbol + observedAt.slice(0, 13));
      const ticker = {
        lastPrice: last.close, openPrice24h: candles.at(-7)?.open ?? candles[0]!.open,
        highPrice24h: Math.max(...candles.slice(-6).map((c) => c.high)), lowPrice24h: Math.min(...candles.slice(-6).map((c) => c.low)),
        bid1Price: last.close * 0.9999, ask1Price: last.close * 1.0001, fundingRate: (random() - 0.5) * 0.001,
      };
      const orderbook = {
        b: Array.from({ length: 10 }, (_, i) => [last.close * (1 - 0.0002 * (i + 1)), 1 + random() * 20]),
        a: Array.from({ length: 10 }, (_, i) => [last.close * (1 + 0.0002 * (i + 1)), 1 + random() * 20]),
      };
      const features = computeMarketFeatures({
        symbol, interval: request.timeframe, observedAt, ticker, orderbook,
        candles: candles.map((c) => [c.ts, c.open, c.high, c.low, c.close, c.volume]),
      });
      const candleSummary = "Synthetic development candles for " + symbol + ". " + renderCandleTable(candles);
      return [
        {
          id: "mock-features:" + symbol + ":" + observedAt,
          title: symbol + " synthetic market features",
          source: "cerebra-mock-evidence",
          observedAt,
          digest: "sha256:" + createHash("sha256").update(JSON.stringify(features)).digest("hex"),
          summary: renderFeatureSummary(features),
          metrics: features as unknown as Record<string, unknown>,
        },
        {
          id: "mock-market:" + symbol + ":" + observedAt,
          title: symbol + " synthetic candle snapshot",
          source: "cerebra-mock-evidence",
          observedAt,
          digest: "sha256:" + createHash("sha256").update(candleSummary).digest("hex"),
          summary: candleSummary,
        },
      ];
    },
    async priceHistory(request) {
      return syntheticCandles(request.asset, "15m", request.endMs, 200)
        .filter((candle) => candle.ts >= request.startMs && candle.ts <= request.endMs);
    },
  };
}
