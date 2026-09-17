import type { EvidenceReference } from "../domain/contracts.js";

export type EvidenceCollectionRequest = {
  asset: string;
  market: string;
  timeframe: string;
};

export interface EvidenceProvider {
  readonly name: string;
  collect(request: EvidenceCollectionRequest): Promise<EvidenceReference[]>;
}
