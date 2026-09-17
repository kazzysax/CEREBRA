import { createHash } from "node:crypto";
import type { EvidenceProvider } from "./contracts.js";

export function createMockEvidenceProvider(
  now: () => Date = () => new Date(),
): EvidenceProvider {
  return {
    name: "mock-market-evidence",
    async collect(request) {
      const observedAt = now().toISOString();
      const summary = [
        "Deterministic development snapshot.",
        "Asset: " + request.asset.toUpperCase() + ".",
        "Market: " + request.market + ".",
        "Timeframe: " + request.timeframe + ".",
      ].join(" ");
      return [{
        id: "mock-market:" + request.asset.toUpperCase() + ":" + observedAt,
        title: request.asset.toUpperCase() + " deterministic market snapshot",
        source: "cerebra-mock-evidence",
        observedAt,
        digest: "sha256:" + createHash("sha256").update(summary).digest("hex"),
        summary,
      }];
    },
  };
}
