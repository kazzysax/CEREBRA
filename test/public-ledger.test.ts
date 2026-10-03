import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";
import { createMockCourtProvider } from "../src/agents/mock-provider.js";
import type { EvidenceProvider } from "../src/evidence/contracts.js";
import { createMockEvidenceProvider } from "../src/evidence/mock-evidence-provider.js";
import type { Candle } from "../src/evidence/market-features.js";
import type { LedgerAppend, LedgerRepository } from "../src/ledger/contracts.js";
import { GENESIS_HASH, canonicalJson, digestReport } from "../src/ledger/hash.js";
import { createMemoryLedgerRepository } from "../src/ledger/memory-repository.js";
import { assetForSlot, createLedgerScheduler, dueSlots, parseSlots } from "../src/ledger/scheduler.js";
import { scoreEntry } from "../src/ledger/score.js";
import { summariseTrackRecord, verifyChain } from "../src/ledger/service.js";
import { createMemoryCaseRepository } from "../src/storage/memory-repository.js";

const adminToken = "ledger-admin-token-that-is-long-enough-for-tests";
const registrationToken = "test-registration-token-that-is-long-enough";

function append(slotKey: string, overrides: Partial<LedgerAppend> = {}): LedgerAppend {
  return {
    slotKey, status: "RULED", source: "SCHEDULED", asset: "TSLAUSDT", timeframe: "4h", riskLevel: "MEDIUM",
    model: "test-model", runId: "run-" + slotKey, ruledAt: "2026-10-01T14:35:00.000Z",
    report: { verdict: "REJECT", slot: slotKey, nested: { b: 1, a: 2 } }, missedReason: null,
    createdAt: "2026-10-01T14:40:00.000Z", ...overrides,
  };
}

test("canonical JSON is key-order independent, so anyone can recompute a digest", () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] }), '{"a":[2,{"d":1}],"b":1}');
  assert.equal(digestReport({ x: 1, y: 2 }), digestReport({ y: 2, x: 1 }));
  assert.notEqual(digestReport({ x: 1 }), digestReport({ x: 2 }));
});

test("the ledger chains entries, refuses a repeated slot, and verifies cleanly", async () => {
  const ledger = createMemoryLedgerRepository();
  const first = (await ledger.append(append("a")))!;
  const second = (await ledger.append(append("b")))!;
  assert.equal(first.seq, 1);
  assert.equal(first.prevHash, GENESIS_HASH);
  assert.equal(second.prevHash, first.entryHash);
  assert.equal(await ledger.append(append("a")), null, "a slot is only ruled once");
  assert.equal((await ledger.list(5, 0)).map((entry) => entry.seq).join(), "2,1", "newest first");
  const verified = await verifyChain(ledger);
  assert.deepEqual([verified.valid, verified.checked, verified.headSeq], [true, 2, 2]);
});

test("editing a published report, or removing an entry, is detected", async () => {
  const ledger = createMemoryLedgerRepository();
  await ledger.append(append("a"));
  await ledger.append(append("b"));
  await ledger.append(append("c"));
  const rows = await ledger.listAll();
  const tampered = (mutate: (rows: Awaited<ReturnType<LedgerRepository["listAll"]>>) => void): LedgerRepository => ({
    ...ledger, async listAll() { const copy = structuredClone(rows); mutate(copy); return copy; },
  });
  const edited = await verifyChain(tampered((copy) => { (copy[1]!.report as { verdict: string }).verdict = "APPROVE"; }));
  assert.deepEqual([edited.valid, edited.firstBrokenSeq, edited.problem], [false, 2, "report content does not match its digest"]);
  const removed = await verifyChain(tampered((copy) => { copy.splice(1, 1); }));
  assert.equal(removed.valid, false);
  assert.equal(removed.firstBrokenSeq, 3);
  const rewritten = await verifyChain(tampered((copy) => { copy[0]!.entry.asset = "NVDAUSDT"; }));
  assert.deepEqual([rewritten.valid, rewritten.firstBrokenSeq], [false, 1]);
});

const candle = (minute: number, open: number, high: number, low: number, close: number): Candle =>
  ({ ts: Date.parse("2026-10-01T14:35:00.000Z") + minute * 60_000, open, high, low, close, volume: 1 });

function evidenceWithPath(path: Candle[]): EvidenceProvider {
  return { name: "fixture", async collect() { return []; }, async priceHistory() { return path; } };
}

async function entryFor(report: unknown, timeframe = "4h") {
  const ledger = createMemoryLedgerRepository();
  const entry = (await ledger.append(append("scored", { report, timeframe })))!;
  return entry;
}

test("scores an actionable recommendation as a win, loss or flat from the real price path", async () => {
  const report = { recommendation: { status: "ACTIONABLE", direction: "SHORT", entryPrice: 100, stopPrice: 102, targetPrice: 96 }, riskCheck: null };
  const entry = await entryFor(report);
  const later = new Date("2026-10-02T10:00:00.000Z");
  const win = await scoreEntry(entry, report, evidenceWithPath([candle(15, 100, 100.5, 95.5, 96)]), later);
  assert.deepEqual([win?.kind, win?.result, win?.thesisOutcome], ["SIGNAL", "WIN", "CONFIRMED"]);
  const loss = await scoreEntry(entry, report, evidenceWithPath([candle(15, 100, 102.5, 99, 101)]), later);
  assert.deepEqual([loss?.result, loss?.thesisOutcome], ["LOSS", "REFUTED"]);
  assert.ok((loss?.realizedReturnPct ?? 0) < 0);
});

test("scores a rejected plan as a counterfactual, so a missed winner counts against the court", async () => {
  const report = {
    recommendation: { status: "NO_TRADE", direction: "NEUTRAL" },
    riskCheck: { primary: { direction: "LONG", entry: 100, stop: 98, target: 104 } },
  };
  const entry = await entryFor(report);
  const later = new Date("2026-10-02T10:00:00.000Z");
  const missed = await scoreEntry(entry, report, evidenceWithPath([candle(30, 100, 104.5, 99.5, 104)]), later);
  assert.deepEqual([missed?.kind, missed?.result], ["REJECTION", "REJECTION_MISSED"]);
  assert.match(missed?.note ?? "", /Counterfactual/);
  const correct = await scoreEntry(entry, report, evidenceWithPath([candle(30, 100, 100.5, 97.5, 98)]), later);
  assert.equal(correct?.result, "REJECTION_CORRECT");
});

test("a ruling with no directional plan is not scorable, and nothing is scored before the horizon", async () => {
  const none = { recommendation: { status: "NO_TRADE", direction: "NEUTRAL" }, riskCheck: { primary: { direction: "NEUTRAL", entry: null, stop: null, target: null } } };
  const entry = await entryFor(none);
  const score = await scoreEntry(entry, none, evidenceWithPath([]), new Date("2026-10-02T10:00:00.000Z"));
  assert.deepEqual([score?.kind, score?.result], ["NOT_SCORABLE", "NOT_SCORABLE"]);
  const open = await scoreEntry(entry, none, evidenceWithPath([]), new Date("2026-10-01T15:00:00.000Z"));
  assert.equal(open, null, "4h horizon still open");
  const noData = await scoreEntry(await entryFor({ recommendation: { status: "ACTIONABLE", direction: "LONG", entryPrice: 1, stopPrice: 0.5, targetPrice: 2 } }),
    { recommendation: { status: "ACTIONABLE", direction: "LONG", entryPrice: 1, stopPrice: 0.5, targetPrice: 2 } }, evidenceWithPath([]), new Date("2026-10-02T10:00:00.000Z"));
  assert.equal(noData, null, "no candles yet: try again later rather than guess");
});

test("slots rotate through the tickers and never invent slots from before the ledger was switched on", () => {
  const slots = parseSlots("14:35,17:05,19:35");
  assert.deepEqual(slots.map((slot) => slot.label), ["14:35", "17:05", "19:35"]);
  const monday = new Date("2026-10-05T00:00:00.000Z");
  const tuesday = new Date("2026-10-06T00:00:00.000Z");
  const todays = slots.map((slot) => assetForSlot(monday, slot, 3));
  const tomorrows = slots.map((slot) => assetForSlot(tuesday, slot, 3));
  assert.equal(new Set([...todays, ...tomorrows]).size, 6, "different tickers on consecutive days");
  assert.equal(dueSlots(new Date("2026-10-05T14:00:00.000Z"), slots, null).length, 0);
  assert.equal(dueSlots(new Date("2026-10-05T18:00:00.000Z"), slots, null).length, 2);
  assert.equal(dueSlots(new Date("2026-10-05T20:00:00.000Z"), slots, new Date("2026-10-05T16:00:00.000Z")).length, 2, "slots before the start are skipped");
  assert.throws(() => parseSlots("25:00"));
});

function schedulerWith(options: { evidenceProvider?: EvidenceProvider; clock: { value: Date }; retryDelayMs?: number }) {
  const ledger = createMemoryLedgerRepository();
  const cases = createMemoryCaseRepository();
  const scheduler = createLedgerScheduler({
    ledger, cases,
    evidenceProvider: options.evidenceProvider ?? createMockEvidenceProvider(),
    courtProvider: createMockCourtProvider(),
    slots: parseSlots("14:35,17:05,19:35"),
    scheduleStart: new Date("2026-10-05T00:00:00.000Z"),
    retryDelayMs: options.retryDelayMs ?? 0,
    now: () => options.clock.value,
  });
  return { ledger, cases, scheduler };
}

test("the scheduler runs each due slot exactly once and publishes it", async () => {
  const clock = { value: new Date("2026-10-05T14:40:00.000Z") };
  const { ledger, scheduler } = schedulerWith({ clock });
  await scheduler.tick();
  await scheduler.tick();
  assert.equal((await ledger.listAll()).length, 1, "no duplicate on a second tick");
  clock.value = new Date("2026-10-05T20:00:00.000Z");
  await scheduler.tick();
  const rows = await ledger.listAll();
  assert.deepEqual(rows.map((row) => row.entry.slotKey), ["2026-10-05#14:35", "2026-10-05#17:05", "2026-10-05#19:35"]);
  assert.ok(rows.every((row) => row.entry.status === "RULED" && row.report !== null && row.entry.source === "SCHEDULED"));
  assert.equal((await verifyChain(ledger)).valid, true);
});

test("a slot that keeps failing is published as MISSED with the reason, not hidden", async () => {
  const broken: EvidenceProvider = { name: "down", async collect() { throw new Error("Bitget unreachable"); } };
  const clock = { value: new Date("2026-10-05T14:40:00.000Z") };
  const { ledger, scheduler } = schedulerWith({ evidenceProvider: broken, clock });
  for (let attempt = 0; attempt < 4; attempt += 1) await scheduler.tick();
  const [only] = await ledger.listAll();
  assert.equal(only?.entry.status, "MISSED");
  assert.equal(only?.entry.missedReason, "Bitget unreachable");
  assert.equal(only?.report, null);
  assert.equal((await verifyChain(ledger)).valid, true);
  assert.equal(summariseTrackRecord(await ledger.listAll(), await verifyChain(ledger)).missedSlots, 1);
});

test("public routes show rulings and the track record, and admin routes are closed without a token", async () => {
  const cases = createMemoryCaseRepository();
  const ledger = createMemoryLedgerRepository();
  const app = await buildApp({ repository: cases, ledgerRepository: ledger, ledger: { enabled: false } });
  assert.equal((await app.inject({ method: "POST", url: "/v1/public/admin/backfill", payload: { runIds: ["x"] } })).statusCode, 404, "no admin routes without a configured token");
  const empty = (await app.inject({ method: "GET", url: "/v1/public/ledger" })).json();
  assert.deepEqual(empty.entries, []);
  await app.close();

  const openApp = await buildApp({ repository: cases, ledgerRepository: ledger, ledger: { enabled: false, adminToken } });
  const created = (await openApp.inject({ method: "POST", url: "/v1/cases", payload: {
    proposal: { asset: "TSLAUSDT", market: "usdt-futures", timeframe: "4h", direction: "EITHER", summary: "Public ledger route test case." }, riskLevel: "MEDIUM",
  } })).json();
  const ran = (await openApp.inject({ method: "POST", url: `/v1/cases/${created.id}/run`, payload: {} })).json();
  const denied = await openApp.inject({ method: "POST", url: "/v1/public/admin/backfill", payload: { runIds: [ran.runId] } });
  assert.equal(denied.statusCode, 401);
  const wrong = await openApp.inject({ method: "POST", url: "/v1/public/admin/backfill", headers: { "x-ledger-admin-token": "wrong" }, payload: { runIds: [ran.runId] } });
  assert.equal(wrong.statusCode, 401);
  const done = await openApp.inject({ method: "POST", url: "/v1/public/admin/backfill", headers: { "x-ledger-admin-token": adminToken }, payload: { runIds: [ran.runId, "does-not-exist"] } });
  assert.deepEqual(done.json(), { appended: [1], skipped: ["does-not-exist"] });
  const again = await openApp.inject({ method: "POST", url: "/v1/public/admin/backfill", headers: { "x-ledger-admin-token": adminToken }, payload: { runIds: [ran.runId] } });
  assert.deepEqual(again.json(), { appended: [], skipped: [ran.runId] }, "a run is published once");

  const list = (await openApp.inject({ method: "GET", url: "/v1/public/ledger?limit=5" })).json();
  assert.equal(list.entries.length, 1);
  const [entry] = list.entries;
  assert.equal(entry.source, "BACKFILL");
  assert.equal(entry.judges.length, 3);
  assert.match(entry.hashes.reportDigest, /^sha256:[0-9a-f]{64}$/);
  const detail = (await openApp.inject({ method: "GET", url: "/v1/public/ledger/1" })).json();
  assert.equal(digestReport(detail.report), entry.hashes.reportDigest, "the published report matches its digest");
  assert.equal((await openApp.inject({ method: "GET", url: "/v1/public/ledger/99" })).statusCode, 404);
  assert.equal((await openApp.inject({ method: "GET", url: "/v1/public/ledger/abc" })).statusCode, 400);
  const verify = (await openApp.inject({ method: "GET", url: "/v1/public/ledger/verify" })).json();
  assert.deepEqual([verify.valid, verify.checked], [true, 1]);
  const record = (await openApp.inject({ method: "GET", url: "/v1/public/track-record" })).json();
  assert.equal(record.rulings, 1);
  assert.equal(record.chain.valid, true);
  await openApp.close();
});

test("an agent's private run can never be published through the ledger", async () => {
  const auth = { mode: "agent-key" as const, apiKeyPepper: "test-agent-key-pepper-that-is-long-enough", registrationToken };
  const cases = createMemoryCaseRepository();
  const app = await buildApp({ repository: cases, auth, ledger: { enabled: false, adminToken } });
  const registered = await app.inject({ method: "POST", url: "/v1/agents/register", headers: { "x-cerebra-registration-token": registrationToken }, payload: { name: "Private Agent" } });
  const headers = { authorization: "Bearer " + (registered.json().apiKey as string) };
  const created = (await app.inject({ method: "POST", url: "/v1/cases", headers, payload: {
    proposal: { asset: "TSLAUSDT", market: "usdt-futures", timeframe: "4h", direction: "EITHER", summary: "A private agent thesis, never public." }, riskLevel: "MEDIUM",
  } })).json();
  const ran = (await app.inject({ method: "POST", url: `/v1/cases/${created.id}/run`, headers, payload: {} })).json();
  const result = await app.inject({ method: "POST", url: "/v1/public/admin/backfill", headers: { "x-ledger-admin-token": adminToken }, payload: { runIds: [ran.runId] } });
  assert.deepEqual(result.json(), { appended: [], skipped: [ran.runId] });
  assert.deepEqual((await app.inject({ method: "GET", url: "/v1/public/ledger" })).json().entries, []);
  await app.close();
});

