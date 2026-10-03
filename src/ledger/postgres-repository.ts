import { Pool } from "pg";
import type { LedgerAppend, LedgerEntry, LedgerRepository, LedgerScore } from "./contracts.js";
import { GENESIS_HASH } from "./hash.js";
import { buildEntry } from "./memory-repository.js";

type Row = Record<string, unknown>;

const LEDGER_LOCK_ID = 7_340_211;

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function entryFromRow(row: Row): LedgerEntry {
  return {
    seq: Number(row.seq),
    prevHash: String(row.prev_hash),
    slotKey: String(row.slot_key),
    status: row.status as LedgerEntry["status"],
    source: row.source as LedgerEntry["source"],
    asset: text(row.asset),
    timeframe: text(row.timeframe),
    riskLevel: text(row.risk_level),
    model: text(row.model),
    runId: text(row.run_id),
    ruledAt: iso(row.ruled_at),
    reportDigest: text(row.report_digest),
    missedReason: text(row.missed_reason),
    createdAt: iso(row.created_at),
    entryHash: String(row.entry_hash),
    score: (row.score as LedgerScore | null) ?? null,
  };
}

const columns = `seq, slot_key, status, source, asset, timeframe, risk_level, model, run_id, ruled_at,
  report_digest, missed_reason, prev_hash, entry_hash, created_at, score`;

export function createPostgresLedgerRepository(options: { connectionString: string; ssl: boolean }): LedgerRepository {
  const pool = new Pool({
    connectionString: options.connectionString,
    ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
  });
  return {
    name: "postgres-ledger",
    async append(input: LedgerAppend) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // One writer at a time, so seq and the hash chain can never fork.
        await client.query("SELECT pg_advisory_xact_lock($1)", [LEDGER_LOCK_ID]);
        const existing = await client.query(
          "SELECT 1 FROM public_ledger WHERE slot_key = $1 OR ($2::text IS NOT NULL AND run_id = $2) LIMIT 1",
          [input.slotKey, input.runId],
        );
        if (existing.rowCount) {
          await client.query("ROLLBACK");
          return null;
        }
        const head = await client.query("SELECT seq, entry_hash FROM public_ledger ORDER BY seq DESC LIMIT 1");
        const entry = buildEntry(
          input,
          head.rowCount ? Number(head.rows[0].seq) + 1 : 1,
          head.rowCount ? String(head.rows[0].entry_hash) : GENESIS_HASH,
        );
        await client.query(
          `INSERT INTO public_ledger (seq, slot_key, status, source, asset, timeframe, risk_level, model, run_id,
             ruled_at, report, report_digest, missed_reason, prev_hash, entry_hash, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16)`,
          [
            entry.seq, entry.slotKey, entry.status, entry.source, entry.asset, entry.timeframe, entry.riskLevel,
            entry.model, entry.runId, entry.ruledAt, input.report === null ? null : JSON.stringify(input.report),
            entry.reportDigest, entry.missedReason, entry.prevHash, entry.entryHash, entry.createdAt,
          ],
        );
        await client.query("COMMIT");
        return entry;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async list(limit, offset) {
      const result = await pool.query(`SELECT ${columns} FROM public_ledger ORDER BY seq DESC LIMIT $1 OFFSET $2`, [limit, offset]);
      return result.rows.map(entryFromRow);
    },
    async get(seq) {
      const result = await pool.query(`SELECT ${columns}, report FROM public_ledger WHERE seq = $1`, [seq]);
      const row = result.rows[0];
      return row ? { entry: entryFromRow(row), report: row.report ?? null } : null;
    },
    async listAll() {
      const result = await pool.query(`SELECT ${columns}, report FROM public_ledger ORDER BY seq ASC`);
      return result.rows.map((row) => ({ entry: entryFromRow(row), report: row.report ?? null }));
    },
    async hasSlot(slotKey) {
      return Boolean((await pool.query("SELECT 1 FROM public_ledger WHERE slot_key = $1", [slotKey])).rowCount);
    },
    async hasRun(runId) {
      return Boolean((await pool.query("SELECT 1 FROM public_ledger WHERE run_id = $1", [runId])).rowCount);
    },
    async setScore(seq, score) {
      await pool.query("UPDATE public_ledger SET score = $2::jsonb WHERE seq = $1 AND score IS NULL", [seq, JSON.stringify(score)]);
    },
    async listUnscored(limit) {
      const result = await pool.query(
        `SELECT ${columns}, report FROM public_ledger WHERE status = 'RULED' AND score IS NULL AND report IS NOT NULL ORDER BY seq ASC LIMIT $1`,
        [limit],
      );
      return result.rows.map((row) => ({ entry: entryFromRow(row), report: row.report }));
    },
    async close() {
      await pool.end();
    },
  };
}
