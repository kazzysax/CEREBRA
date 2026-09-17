import { createHash } from "node:crypto";
import {
  BitgetRestClient,
  buildTools,
  loadConfig,
  safeInvoke,
} from "@bitget-ai/bitget-agent-sdk";
import type { EvidenceReference } from "../domain/contracts.js";
import type { EvidenceCollectionRequest, EvidenceProvider } from "./contracts.js";

type MarketAction = "tickers" | "orderbook" | "candles";
export type BitgetMarketInvoker = (
  action: MarketAction,
  input: Record<string, unknown>,
) => Promise<unknown>;

export type BitgetEvidenceProviderOptions = {
  invoke?: BitgetMarketInvoker | undefined;
  now?: (() => Date) | undefined;
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function compactSummary(action: MarketAction, value: unknown): string {
  const serialized = stableJson(value);
  const maximum = 7_700;
  return "Bitget " + action + " response: " +
    (serialized.length <= maximum ? serialized : serialized.slice(0, maximum) + "...[truncated]");
}

function categoryFor(market: string): string {
  const normalized = market.trim().toLowerCase().replaceAll("_", "-");
  if (["future", "futures", "perp", "perpetual", "usdt-futures"].includes(normalized)) {
    return "USDT-FUTURES";
  }
  if (["coin-futures", "coin-m", "coinm"].includes(normalized)) return "COIN-FUTURES";
  if (["usdc-futures", "usdc-perp"].includes(normalized)) return "USDC-FUTURES";
  return "SPOT";
}

function intervalFor(timeframe: string): string {
  const normalized = timeframe.trim().toLowerCase();
  const intervals: Record<string, string> = {
    "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
    "1h": "1H", "4h": "4H", "6h": "6H", "12h": "12H", "1d": "1D",
  };
  return intervals[normalized] ?? "1H";
}

function unwrapInvocation(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const result = value as { ok?: boolean; data?: unknown; error?: unknown };
  if (result.ok === false) {
    throw new Error("Bitget market request failed: " + stableJson(result.error ?? value));
  }
  return "data" in result ? result.data : value;
}

function createDefaultInvoker(): BitgetMarketInvoker {
  const config = loadConfig({ modules: "market", readOnly: true });
  const client = new BitgetRestClient(config);
  const tools = buildTools(config);
  const market = tools.find((tool) => tool.name === "market");
  if (!market) throw new Error("The Bitget SDK market tool is unavailable");

  return async (action, input) => safeInvoke(
    market,
    { action, ...input },
    { config, client },
  );
}

export function createBitgetEvidenceProvider(
  options: BitgetEvidenceProviderOptions = {},
): EvidenceProvider {
  const invoke = options.invoke ?? createDefaultInvoker();
  const now = options.now ?? (() => new Date());

  return {
    name: "bitget-agent-sdk",
    async collect(request: EvidenceCollectionRequest): Promise<EvidenceReference[]> {
      const symbol = request.asset.trim().toUpperCase();
      const category = categoryFor(request.market);
      const interval = intervalFor(request.timeframe);
      const observedAt = now().toISOString();
      const calls: Array<{ action: MarketAction; input: Record<string, unknown>; uri: string }> = [
        {
          action: "tickers",
          input: { category, symbol, view: "summary" },
          uri: "https://api.bitget.com/api/v3/market/tickers",
        },
        {
          action: "orderbook",
          input: { category, symbol, limit: "20", view: "summary" },
          uri: "https://api.bitget.com/api/v3/market/orderbook",
        },
        {
          action: "candles",
          input: { category, symbol, interval, limit: "24", view: "summary" },
          uri: "https://api.bitget.com/api/v3/market/candles",
        },
      ];

      return Promise.all(calls.map(async ({ action, input, uri }) => {
        const data = unwrapInvocation(await invoke(action, input));
        const raw = { action, category, symbol, interval, data };
        return {
          id: "bitget:" + action + ":" + symbol + ":" + observedAt,
          title: "Bitget " + symbol + " " + action + " snapshot",
          source: "bitget-agent-sdk",
          observedAt,
          uri,
          digest: "sha256:" + createHash("sha256").update(stableJson(raw)).digest("hex"),
          summary: compactSummary(action, data),
        };
      }));
    },
  };
}
