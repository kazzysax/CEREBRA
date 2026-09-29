import type { EvidenceReference } from "../src/domain/contracts.js";
import { computeMarketFeatures, renderFeatureSummary } from "../src/evidence/market-features.js";

// Evidence carrying real computed market features, so the data-driven mock
// court has something to judge. `trend` shapes the candles; `depth` skews the
// order book (ASK_HEAVY makes the strategy judge dissent from a LONG).
export function featureEvidence(options: {
  asset?: string;
  trend?: "UP" | "DOWN" | "FLAT";
  depth?: "BID_HEAVY" | "ASK_HEAVY" | "BALANCED";
  observedAt?: string;
  id?: string;
} = {}): EvidenceReference[] {
  const asset = options.asset ?? "TSLAUSDT";
  const observedAt = options.observedAt ?? "2026-09-29T12:00:00.000Z";
  const step = options.trend === "DOWN" ? -1 : options.trend === "FLAT" ? 0 : 1;
  const start = Date.parse(observedAt) - 24 * 14_400_000;
  const candles = Array.from({ length: 24 }, (_, index) => {
    const open = 100 + step * index + (index % 2 ? 0.3 : -0.3) * (step === 0 ? 1 : 0);
    const close = open + step * 0.9 + (step === 0 ? (index % 2 ? -0.3 : 0.3) : 0);
    return [start + index * 14_400_000, open, Math.max(open, close) + 0.4, Math.min(open, close) - 0.4, close, 500];
  });
  const last = candles.at(-1)![4] as number;
  const heavy = 40;
  const bidSize = options.depth === "ASK_HEAVY" ? 2 : options.depth === "BALANCED" ? 10 : heavy;
  const askSize = options.depth === "ASK_HEAVY" ? heavy : options.depth === "BALANCED" ? 10 : 2;
  const features = computeMarketFeatures({
    symbol: asset,
    interval: "4H",
    observedAt,
    ticker: [{ lastPrice: String(last), openPrice24h: String(candles.at(-7)![1]), highPrice24h: String(last + 1), lowPrice24h: String(last - 6), bid1Price: String(last - 0.01), ask1Price: String(last + 0.01), fundingRate: "0.0001" }],
    orderbook: {
      b: Array.from({ length: 5 }, (_, index) => [last - 0.01 * (index + 1), bidSize]),
      a: Array.from({ length: 5 }, (_, index) => [last + 0.01 * (index + 1), askSize]),
    },
    candles,
  });
  return [{
    id: options.id ?? "features:" + asset,
    title: asset + " measured market features",
    source: "cerebra-market-features",
    observedAt,
    digest: "sha256:fixture-features-" + asset,
    summary: renderFeatureSummary(features),
    metrics: features as unknown as Record<string, unknown>,
  }];
}
