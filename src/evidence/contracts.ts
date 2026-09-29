import type { EvidenceReference } from "../domain/contracts.js";
import type { Candle } from "./market-features.js";

export type EvidenceCollectionRequest = {
  asset: string;
  market: string;
  timeframe: string;
};

export type PriceHistoryRequest = {
  asset: string;
  market: string;
  interval: string;
  startMs: number;
  endMs: number;
};

export interface EvidenceProvider {
  readonly name: string;
  collect(request: EvidenceCollectionRequest): Promise<EvidenceReference[]>;
  // Candles after a ruling, used to resolve what the market actually did.
  priceHistory?(request: PriceHistoryRequest): Promise<Candle[]>;
}
