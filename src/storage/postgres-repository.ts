import { Pool, type PoolClient } from "pg";
import { caseSubmissionSchema } from "../agents/contracts.js";
import type { CourtRunResult } from "../court/run-court.js";
import { rulingReportSchema, type EvidenceReference } from "../domain/contracts.js";
import type {
  CaseRecord,
  CaseRepository,
  CaseStatus,
  CourtRunRecord,
  StoredReport,
} from "./contracts.js";

type Row = Record<string, unknown>;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function caseFromRow(row: Row): CaseRecord {
  return {
    id: String(row.id),
    submission: caseSubmissionSchema.parse({
      proposal: row.proposal,
      riskLevel: row.risk_level,
      evidence: row.evidence,
    }),
    evidenceMode: row.evidence_mode as CaseRecord["evidenceMode"],
    status: row.status as CaseRecord["status"],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function runFromRow(row: Row): CourtRunRecord {
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    status: row.status as CourtRunRecord["status"],
    provider: String(row.provider),
    model: String(row.model),
    startedAt: iso(row.started_at),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    result: (row.result as CourtRunResult | null) ?? null,
    error: row.error === null || row.error === undefined ? null : String(row.error),
  };
}

async function insertAgentOutputs(client: PoolClient, result: CourtRunResult) {
  const outputs: Array<{ stage: string; judgeId: string | null; output: unknown }> = [
    { stage: "ANALYST", judgeId: null, output: result.analystCase },
    { stage: "CHALLENGER", judgeId: null, output: result.challenge },
    ...result.report.judges.map((output) => ({
      stage: "JUDGE",
      judgeId: output.judgeId,
      output,
    })),
  ];

  for (const [ordinal, entry] of outputs.entries()) {
    const trace = result.trace.find((item) =>
      item.stage === entry.stage && item.judgeId === entry.judgeId
    );
    await client.query(
      `INSERT INTO agent_outputs
        (run_id, ordinal, stage, judge_id, status, provider, model, output, usage, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
      [
        result.runId,
        ordinal,
        entry.stage,
        entry.judgeId,
        trace?.status ?? "SUCCEEDED",
        trace?.provider ?? result.provider,
        trace?.model ?? result.model,
        JSON.stringify(entry.output),
        JSON.stringify(trace?.usage ?? null),
        trace?.error ?? null,
      ],
    );
  }
}

export function createPostgresCaseRepository(options: {
  connectionString: string;
  ssl: boolean;
}): CaseRepository {
  const pool = new Pool({
    connectionString: options.connectionString,
    ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
  });

  return {
    name: "postgres",

    async createCase(record) {
      const result = await pool.query(
        `INSERT INTO cases
          (id, proposal, risk_level, evidence_mode, evidence, status, created_at, updated_at)
         VALUES ($1,$2::jsonb,$3,$4,$5::jsonb,$6,$7,$8)
         RETURNING *`,
        [
          record.id,
          JSON.stringify(record.submission.proposal),
          record.submission.riskLevel,
          record.evidenceMode,
          JSON.stringify(record.submission.evidence),
          record.status,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return caseFromRow(result.rows[0] as Row);
    },

    async listCases(limit) {
      const result = await pool.query(
        "SELECT * FROM cases ORDER BY created_at DESC LIMIT $1",
        [limit],
      );
      return result.rows.map((row) => caseFromRow(row as Row));
    },

    async getCase(id) {
      const result = await pool.query("SELECT * FROM cases WHERE id = $1", [id]);
      return result.rowCount ? caseFromRow(result.rows[0] as Row) : null;
    },

    async replaceEvidence(id, evidence: EvidenceReference[], updatedAt) {
      const result = await pool.query(
        `UPDATE cases SET evidence = $2::jsonb, status = 'READY', updated_at = $3
         WHERE id = $1 RETURNING *`,
        [id, JSON.stringify(evidence), updatedAt],
      );
      return result.rowCount ? caseFromRow(result.rows[0] as Row) : null;
    },

    async setCaseStatus(id: string, status: CaseStatus, updatedAt: string) {
      await pool.query(
        "UPDATE cases SET status = $2, updated_at = $3 WHERE id = $1",
        [id, status, updatedAt],
      );
    },

    async createRun(record) {
      const result = await pool.query(
        `INSERT INTO court_runs
          (id, case_id, status, provider, model, started_at, completed_at, result, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         RETURNING *`,
        [
          record.id,
          record.caseId,
          record.status,
          record.provider,
          record.model,
          record.startedAt,
          record.completedAt,
          record.result ? JSON.stringify(record.result) : null,
          record.error,
        ],
      );
      return runFromRow(result.rows[0] as Row);
    },

    async completeRun(id, result, markdown) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE court_runs
           SET status = 'COMPLETED', completed_at = $2, result = $3::jsonb, error = NULL
           WHERE id = $1`,
          [id, result.completedAt, JSON.stringify(result)],
        );
        await client.query(
          `INSERT INTO ruling_reports
            (report_id, run_id, status, verdict, report, markdown, created_at)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
           ON CONFLICT (run_id) DO UPDATE SET
             status = EXCLUDED.status, verdict = EXCLUDED.verdict,
             report = EXCLUDED.report, markdown = EXCLUDED.markdown,
             created_at = EXCLUDED.created_at`,
          [
            result.report.reportId,
            id,
            result.report.status,
            result.report.verdict,
            JSON.stringify(result.report),
            markdown,
            result.completedAt,
          ],
        );
        await client.query("DELETE FROM agent_outputs WHERE run_id = $1", [id]);
        await insertAgentOutputs(client, result);
        await client.query(
          `UPDATE cases SET status = 'COMPLETED', updated_at = $2
           WHERE id = (SELECT case_id FROM court_runs WHERE id = $1)`,
          [id, result.completedAt],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },

    async failRun(id, error, completedAt) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE court_runs SET status = 'FAILED', completed_at = $2, error = $3
           WHERE id = $1`,
          [id, completedAt, error],
        );
        await client.query(
          `UPDATE cases SET status = 'FAILED', updated_at = $2
           WHERE id = (SELECT case_id FROM court_runs WHERE id = $1)`,
          [id, completedAt],
        );
        await client.query("COMMIT");
      } catch (failure) {
        await client.query("ROLLBACK");
        throw failure;
      } finally {
        client.release();
      }
    },

    async getRun(id) {
      const result = await pool.query("SELECT * FROM court_runs WHERE id = $1", [id]);
      return result.rowCount ? runFromRow(result.rows[0] as Row) : null;
    },

    async getReport(runId): Promise<StoredReport | null> {
      const result = await pool.query(
        "SELECT run_id, report, markdown, created_at FROM ruling_reports WHERE run_id = $1",
        [runId],
      );
      if (!result.rowCount) return null;
      const row = result.rows[0] as Row;
      return {
        runId: String(row.run_id),
        report: rulingReportSchema.parse(row.report),
        markdown: String(row.markdown),
        createdAt: iso(row.created_at),
      };
    },

    async close() {
      await pool.end();
    },
  };
}
