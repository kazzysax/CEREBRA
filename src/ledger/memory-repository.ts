import type { LedgerAppend, LedgerEntry, LedgerRepository, LedgerScore } from "./contracts.js";
import { GENESIS_HASH, computeEntryHash, digestReport } from "./hash.js";

export function buildEntry(input: LedgerAppend, seq: number, prevHash: string): LedgerEntry {
  const fields = {
    seq,
    prevHash,
    slotKey: input.slotKey,
    status: input.status,
    source: input.source,
    asset: input.asset,
    timeframe: input.timeframe,
    riskLevel: input.riskLevel,
    model: input.model,
    runId: input.runId,
    ruledAt: input.ruledAt,
    reportDigest: input.report === null ? null : digestReport(input.report),
    missedReason: input.missedReason,
    createdAt: input.createdAt,
  };
  return { ...fields, entryHash: computeEntryHash(fields), score: null };
}

export function createMemoryLedgerRepository(): LedgerRepository {
  const rows: Array<{ entry: LedgerEntry; report: unknown | null }> = [];
  return {
    name: "memory-ledger",
    async append(input) {
      if (rows.some((row) => row.entry.slotKey === input.slotKey)) return null;
      if (input.runId && rows.some((row) => row.entry.runId === input.runId)) return null;
      const last = rows.at(-1);
      const entry = buildEntry(input, (last?.entry.seq ?? 0) + 1, last?.entry.entryHash ?? GENESIS_HASH);
      rows.push({ entry, report: input.report === null ? null : structuredClone(input.report) });
      return structuredClone(entry);
    },
    async list(limit, offset) {
      return rows.map((row) => structuredClone(row.entry)).reverse().slice(offset, offset + limit);
    },
    async get(seq) {
      const row = rows.find((item) => item.entry.seq === seq);
      return row ? structuredClone(row) : null;
    },
    async listAll() {
      return rows.map((row) => structuredClone(row));
    },
    async hasSlot(slotKey) {
      return rows.some((row) => row.entry.slotKey === slotKey);
    },
    async hasRun(runId) {
      return rows.some((row) => row.entry.runId === runId);
    },
    async setScore(seq, score: LedgerScore) {
      const row = rows.find((item) => item.entry.seq === seq);
      if (row && row.entry.score === null) row.entry.score = structuredClone(score);
    },
    async listUnscored(limit) {
      return rows
        .filter((row) => row.entry.status === "RULED" && row.entry.score === null && row.report !== null)
        .slice(0, limit)
        .map((row) => structuredClone(row) as { entry: LedgerEntry; report: unknown });
    },
    async close() {},
  };
}
