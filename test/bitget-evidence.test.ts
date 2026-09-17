import assert from "node:assert/strict";
import test from "node:test";
import { createBitgetEvidenceProvider } from "../src/evidence/bitget-evidence-provider.js";

test("collects ticker, orderbook, and candle evidence through the Bitget SDK contract", async () => {
  const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
  const provider = createBitgetEvidenceProvider({
    now: () => new Date("2026-09-17T12:00:00.000Z"),
    async invoke(action, input) {
      calls.push({ action, input });
      return { ok: true, data: { action, fixture: true, price: "62000" } };
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
  assert.equal(evidence.length, 3);
  assert.ok(evidence.every((item) => item.source === "bitget-agent-sdk"));
  assert.match(evidence[0]!.summary!, /62000/);
  assert.match(evidence[0]!.digest, /^sha256:[a-f0-9]{64}$/);
});

test("surfaces a failed Bitget safe invocation", async () => {
  const provider = createBitgetEvidenceProvider({
    async invoke() {
      return { ok: false, error: { message: "rate limited" } };
    },
  });

  await assert.rejects(
    provider.collect({ asset: "ETHUSDT", market: "spot", timeframe: "1h" }),
    /rate limited/,
  );
});
