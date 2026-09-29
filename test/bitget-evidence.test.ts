import assert from "node:assert/strict";
import test from "node:test";
import { createBitgetEvidenceProvider } from "../src/evidence/bitget-evidence-provider.js";

test("collects ticker, orderbook, and candle evidence through the Bitget SDK contract", async () => {
  const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
  const provider = createBitgetEvidenceProvider({
    now: () => new Date("2026-09-17T12:00:00.000Z"),
    async invoke(action, input) {
      calls.push({ action, input });
      if (action === "tickers") return { ok: true, data: [{ lastPrice: "62000", openPrice24h: "61000", highPrice24h: "62500", lowPrice24h: "60500" }] };
      if (action === "orderbook") return { ok: true, data: { b: [[61999, 5]], a: [[62001, 1]] } };
      // Oldest first, as Bitget returns them.
      return { ok: true, data: Array.from({ length: 30 }, (_, index) => [String(1_790_000_000_000 + index * 14_400_000), String(60000 + index * 50), String(60100 + index * 50), String(59950 + index * 50), String(60040 + index * 50), "10"]) };
    },
  });

  const evidence = await provider.collect({
    asset: "btcusdt",
    market: "usdt_futures",
    timeframe: "4h",
  });

  assert.deepEqual(calls.map((call) => call.action), ["tickers", "orderbook", "candles"]);
  assert.ok(calls.every((call) => call.input.category === "USDT-FUTURES"));
  assert.equal(calls[2]?.input.interval, "4H");
  assert.equal(evidence.length, 4);
  // Measured features come first; the three raw snapshots follow.
  assert.equal(evidence[0]!.source, "cerebra-market-features");
  assert.equal(evidence[0]!.metrics?.lastPrice, 62000);
  assert.match(evidence[0]!.summary!, /Trend classification: UP/);
  assert.ok(evidence.slice(1).every((item) => item.source === "bitget-agent-sdk"));
  assert.match(evidence[1]!.summary!, /62000/);
  assert.match(evidence[1]!.digest, /^sha256:[a-f0-9]{64}$/);
  // The candle table is newest-first, so no cap can hide the latest bars.
  const table = evidence[3]!.summary!.split("\n");
  // Newest candle: index 29 -> close 60040 + 29*50 = 61490.
  assert.match(table[1]!, /,61490,/);
  assert.equal(calls[2]?.input.limit, "48");
});

test("surfaces a failed Bitget safe invocation", async () => {
  const provider = createBitgetEvidenceProvider({
    async invoke() {
      return { ok: false, error: { message: "rate limited" } };
    },
  });

  await assert.rejects(
    provider.collect({ asset: "ETHUSDT", market: "usdt-futures", timeframe: "1h" }),
    /rate limited/,
  );
});
