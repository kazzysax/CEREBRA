import { Pool } from "pg";
import type { CourtJobRecord, CourtJobRepository } from "./contracts.js";

type Row = Record<string, unknown>;
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
function fromRow(row: Row): CourtJobRecord {
  return {
    id: String(row.id), agentId: String(row.agent_id), caseId: String(row.case_id),
    runId: row.run_id ? String(row.run_id) : null,
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    refreshEvidence: Boolean(row.refresh_evidence), status: row.status as CourtJobRecord["status"],
    stage: row.stage as CourtJobRecord["stage"], attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts), generation: Number(row.generation),
    leaseOwner: row.lease_owner ? String(row.lease_owner) : null,
    leaseExpiresAt: row.lease_expires_at ? iso(row.lease_expires_at) : null,
    error: row.error ? String(row.error) : null, createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at), completedAt: row.completed_at ? iso(row.completed_at) : null,
  };
}

export function createPostgresCourtJobRepository(options: { connectionString: string; ssl: boolean }): CourtJobRepository {
  const pool = new Pool({ connectionString: options.connectionString, ssl: options.ssl ? { rejectUnauthorized: false } : undefined });
  return {
    name: "postgres",
    async createJob(record) {
      const result = await pool.query(
        `INSERT INTO court_jobs
          (id, agent_id, case_id, run_id, idempotency_key, refresh_evidence, status, stage,
           attempt_count, max_attempts, generation, lease_owner, lease_expires_at, error, created_at, updated_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (agent_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET updated_at = court_jobs.updated_at
         RETURNING *`,
        [record.id, record.agentId, record.caseId, record.runId, record.idempotencyKey, record.refreshEvidence,
          record.status, record.stage, record.attemptCount, record.maxAttempts, record.generation,
          record.leaseOwner, record.leaseExpiresAt, record.error, record.createdAt, record.updatedAt, record.completedAt],
      );
      return fromRow(result.rows[0] as Row);
    },
    async getJob(id, agentId) {
      const result = await pool.query("SELECT * FROM court_jobs WHERE id = $1 AND agent_id = $2", [id, agentId]);
      return result.rowCount ? fromRow(result.rows[0] as Row) : null;
    },
    async getByIdempotencyKey(agentId, key) {
      const result = await pool.query("SELECT * FROM court_jobs WHERE agent_id = $1 AND idempotency_key = $2", [agentId, key]);
      return result.rowCount ? fromRow(result.rows[0] as Row) : null;
    },
    async claimNext(workerId, now, leaseExpiresAt) {
      const result = await pool.query(
        `WITH candidate AS (
           SELECT id FROM court_jobs
           WHERE attempt_count < max_attempts
             AND (status = 'QUEUED' OR (status = 'RUNNING' AND lease_expires_at <= $1))
           ORDER BY created_at ASC
           FOR UPDATE SKIP LOCKED LIMIT 1
         )
         UPDATE court_jobs AS job SET
           status = 'RUNNING', stage = 'CLAIMED', attempt_count = job.attempt_count + 1,
           generation = job.generation + 1, lease_owner = $2, lease_expires_at = $3, updated_at = $1
         FROM candidate WHERE job.id = candidate.id RETURNING job.*`,
        [now, workerId, leaseExpiresAt],
      );
      return result.rowCount ? fromRow(result.rows[0] as Row) : null;
    },
    async updateStage(id, generation, stage, now) {
      const result = await pool.query(
        "UPDATE court_jobs SET stage = $3, updated_at = $4 WHERE id = $1 AND generation = $2 AND status = 'RUNNING'",
        [id, generation, stage, now],
      );
      return Boolean(result.rowCount);
    },
    async completeJob(id, generation, runId, now) {
      const result = await pool.query(
        `UPDATE court_jobs SET run_id = $3, status = 'COMPLETED', stage = 'COMPLETED',
         lease_owner = NULL, lease_expires_at = NULL, error = NULL, updated_at = $4, completed_at = $4
         WHERE id = $1 AND generation = $2 AND status = 'RUNNING'`,
        [id, generation, runId, now],
      );
      return Boolean(result.rowCount);
    },
    async failJob(id, generation, error, retryable, now) {
      const result = await pool.query(
        `UPDATE court_jobs SET
           status = CASE WHEN $4 AND attempt_count < max_attempts THEN 'QUEUED' ELSE 'FAILED' END,
           stage = CASE WHEN $4 AND attempt_count < max_attempts THEN 'RETRYING' ELSE 'FAILED' END,
           lease_owner = NULL, lease_expires_at = NULL, error = $3, updated_at = $5,
           completed_at = CASE WHEN $4 AND attempt_count < max_attempts THEN NULL ELSE $5::timestamptz END
         WHERE id = $1 AND generation = $2 AND status = 'RUNNING'`,
        [id, generation, error.slice(0, 1_000), retryable, now],
      );
      return Boolean(result.rowCount);
    },
    async cancelQueuedJob(id, agentId, now) {
      const result = await pool.query(
        `UPDATE court_jobs SET status = 'CANCELLED', stage = 'CANCELLED', generation = generation + 1,
         updated_at = $3, completed_at = $3 WHERE id = $1 AND agent_id = $2 AND status = 'QUEUED' RETURNING *`,
        [id, agentId, now],
      );
      return result.rowCount ? fromRow(result.rows[0] as Row) : null;
    },
    async close() { await pool.end(); },
  };
}
