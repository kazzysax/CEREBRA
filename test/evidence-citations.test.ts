import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidenceView } from "../src/agents/llm-court.js";
import type { CaseSubmission } from "../src/agents/contracts.js";

function viewFor(...ids: string[]) {
  const submission = {
    proposal: { asset: "TSLAUSDT", market: "usdt-futures", timeframe: "4h", direction: "EITHER", summary: "Citation normalization fixture." },
    riskLevel: "MEDIUM",
    evidence: ids.map((id) => ({ id, title: id, source: "fixture", observedAt: "2026-09-22T11:25:45.432Z", digest: "sha256:x" })),
  } as CaseSubmission;
  return buildEvidenceView(submission);
}

const tickerId = "bitget:tickers:BTCUSDT:2026-09-22T11:25:45.432Z";

test("labels evidence E1..En and resolves aliases back to real IDs", () => {
  const view = viewFor(tickerId, "ev-2");
  assert.deepEqual(view.items.map((item) => item.ref), ["E1", "E2"]);
  assert.equal(view.resolve("E1"), tickerId);
  assert.equal(view.resolve("e2"), "ev-2");
});

test("resolves decorated aliases models produce", () => {
  const view = viewFor(tickerId);
  for (const decorated of ["[E1]", "EVIDENCE: E1", "Evidence ID: E1", "E1.", "\"E1\""]) {
    assert.equal(view.resolve(decorated), tickerId, decorated);
  }
});

test("passes exact IDs through and strips decorations seen live in production", () => {
  const view = viewFor(tickerId, "ev-1");
  assert.equal(view.resolve(tickerId), tickerId);
  assert.equal(view.resolve("EVIDENCE:" + tickerId), tickerId);
  assert.equal(view.resolve("evidence :  " + tickerId), tickerId);
  assert.equal(view.resolve("]" + tickerId), tickerId);
  assert.equal(view.resolve("EVIDENCE ev-1"), "ev-1");
});

test("collapses an immediately repeated path segment", () => {
  const candles = "bitget:candles:BTCUSDT:2026-09-22T11:25:45.432Z";
  assert.equal(viewFor(candles).resolve("bitget:candles:BTCUSDT:BTCUSDT:2026-09-22T11:25:45.432Z"), candles);
});

test("leaves genuinely unknown citations unchanged so the court can flag them", () => {
  const view = viewFor(tickerId);
  assert.equal(view.resolve("E9"), "E9");
  assert.equal(view.resolve("https://bitget.com/api/v2/mix/market/candles"), "https://bitget.com/api/v2/mix/market/candles");
  assert.equal(view.resolve("bitget:tickers:ETHUSDT:2026-09-22T11:25:45.432Z"), "bitget:tickers:ETHUSDT:2026-09-22T11:25:45.432Z");
});
