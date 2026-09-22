import assert from "node:assert/strict";
import test from "node:test";
import { normalizeKnownEvidenceId } from "../src/agents/qwen-provider.js";

const knownIds = new Set(["bitget:tickers:BTCUSDT:2026-09-22T11:25:45.432Z"]);

test("passes an exact evidence ID through unchanged", () => {
  const id = "bitget:tickers:BTCUSDT:2026-09-22T11:25:45.432Z";
  assert.equal(normalizeKnownEvidenceId(id, knownIds), id);
});

test("strips a decorative EVIDENCE: prefix when the remainder is exact", () => {
  const decorated = "EVIDENCE:bitget:tickers:BTCUSDT:2026-09-22T11:25:45.432Z";
  assert.equal(normalizeKnownEvidenceId(decorated, knownIds), "bitget:tickers:BTCUSDT:2026-09-22T11:25:45.432Z");
});

test("strips the prefix case-insensitively and tolerates spacing", () => {
  const decorated = "evidence :  bitget:tickers:BTCUSDT:2026-09-22T11:25:45.432Z";
  assert.equal(normalizeKnownEvidenceId(decorated, knownIds), "bitget:tickers:BTCUSDT:2026-09-22T11:25:45.432Z");
});

test("collapses an immediately repeated path segment", () => {
  const duplicated = new Set(["bitget:candles:BTCUSDT:2026-09-22T11:25:45.432Z"]);
  const id = "bitget:candles:BTCUSDT:BTCUSDT:2026-09-22T11:25:45.432Z";
  assert.equal(normalizeKnownEvidenceId(id, duplicated), "bitget:candles:BTCUSDT:2026-09-22T11:25:45.432Z");
});

test("leaves a genuinely unknown citation unchanged so validation still catches it", () => {
  const id = "bitget:tickers:ETHUSDT:2026-09-22T11:25:45.432Z";
  assert.equal(normalizeKnownEvidenceId(id, knownIds), id);
});

test("does not over-normalize a prefixed-but-still-unknown ID", () => {
  const id = "EVIDENCE:bitget:tickers:ETHUSDT:2026-09-22T11:25:45.432Z";
  assert.equal(normalizeKnownEvidenceId(id, knownIds), id);
});

test("strips a colon-less EVIDENCE prefix, seen live in production", () => {
  const knownManualIds = new Set(["ev-1"]);
  const id = "EVIDENCE ev-1";
  assert.equal(normalizeKnownEvidenceId(id, knownManualIds), "ev-1");
});

test("strips an 'Evidence ID:' prefix", () => {
  const knownManualIds = new Set(["ev-1"]);
  const id = "Evidence ID: ev-1";
  assert.equal(normalizeKnownEvidenceId(id, knownManualIds), "ev-1");
});
