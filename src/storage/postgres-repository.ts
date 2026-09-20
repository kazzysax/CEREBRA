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
import type { JudgeCalibration, OutcomeRecord } from "../outcomes/contracts.js";

type Row = Record<string, unknown>;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function caseFromRow(row: Row): CaseRecord {
  return {
    id: String(row.id),
    agentId: row.agent_id === null || row.agent_id === undefined ? null : String(row.agent_id),
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
          (id, agent_id, proposal, risk_level, evidence_mode, evidence, status, created_at, updated_at)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7,$8,$9)
         RETURNING *`,
        [
          record.id,
          record.agentId,
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

    async listCases(limit, agentId) {
      const result = await pool.query(
        `SELECT * FROM cases
         WHERE ($2::text IS NULL OR agent_id = $2)
         ORDER BY created_at DESC LIMIT $1`,
        [limit, agentId ?? null],
      );
      return result.rows.map((row) => caseFromRow(row as Row));
    },

    async getCase(id, agentId) {
      const result = await pool.query(
        "SELECT * FROM cases WHERE id = $1 AND ($2::text IS NULL OR agent_id = $2)",
        [id, agentId ?? null],
      );
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

    async getRun(id, agentId) {
      const result = await pool.query(
        `SELECT court_runs.* FROM court_runs
         JOIN cases ON cases.id = court_runs.case_id
         WHERE court_runs.id = $1 AND ($2::text IS NULL OR cases.agent_id = $2)`,
        [id, agentId ?? null],
      );
      return result.rowCount ? runFromRow(result.rows[0] as Row) : null;
    },

    async getReport(runId, agentId): Promise<StoredReport | null> {
      const result = await pool.query(
        `SELECT ruling_reports.run_id, ruling_reports.report, ruling_reports.markdown, ruling_reports.created_at
         FROM ruling_reports
         JOIN court_runs ON court_runs.id = ruling_reports.run_id
         JOIN cases ON cases.id = court_runs.case_id
         WHERE ruling_reports.run_id = $1 AND ($2::text IS NULL OR cases.agent_id = $2)`,
        [runId, agentId ?? null],
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

    async findPrecedents(query) {
      const result = await pool.query(
        `SELECT cases.id AS case_id, cases.proposal, cases.risk_level,
                court_runs.id AS run_id, court_runs.completed_at, ruling_reports.report
         FROM cases
         JOIN court_runs ON court_runs.case_id = cases.id AND court_runs.status = 'COMPLETED'
         JOIN ruling_reports ON ruling_reports.run_id = court_runs.id
         WHERE cases.agent_id = $1
           AND cases.proposal->>'asset' = $2
           AND cases.proposal->>'market' = $3
           AND cases.id <> $4
         ORDER BY court_runs.completed_at DESC
         LIMIT $5`,
        [query.agentId, query.asset, query.market, query.excludeCaseId, query.limit],
      );
      return result.rows.map((row) => {
        const proposal = row.proposal as { asset: string; market: string; timeframe: string; summary: string };
        const report = rulingReportSchema.parse(row.report);
        return {
          caseId: String(row.case_id),
          runId: String(row.run_id),
          concludedAt: iso(row.completed_at),
          asset: proposal.asset,
          market: proposal.market,
          timeframe: proposal.timeframe,
          riskLevel: row.risk_level as "LOW" | "MEDIUM" | "HIGH",
          proposalSummary: proposal.summary,
          status: report.status,
          verdict: report.verdict,
          dissentingJudgeIds: report.dissentingJudgeIds,
        };
      });
    },

    async saveOutcome(record) {
      const result = await pool.query(
        `INSERT INTO court_outcomes (id, run_id, agent_id, horizon, thesis_outcome, realized_return_pct, note, observed_at, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (run_id, horizon) DO UPDATE SET thesis_outcome = EXCLUDED.thesis_outcome, realized_return_pct = EXCLUDED.realized_return_pct, note = EXCLUDED.note, observed_at = EXCLUDED.observed_at, recorded_at = EXCLUDED.recorded_at
         RETURNING *`,
        [record.id, record.runId, record.agentId, record.horizon, record.thesisOutcome, record.realizedReturnPct ?? null, record.note ?? null, record.observedAt, record.recordedAt],
      );
      const row = result.rows[0] as Row;
      return { id: String(row.id), runId: String(row.run_id), agentId: String(row.agent_id), horizon: row.horizon as OutcomeRecord["horizon"], thesisOutcome: row.thesis_outcome as OutcomeRecord["thesisOutcome"], realizedReturnPct: row.realized_return_pct === null ? undefined : Number(row.realized_return_pct), note: row.note === null ? undefined : String(row.note), observedAt: iso(row.observed_at), recordedAt: iso(row.recorded_at) };
    },

    async listOutcomes(runId, agentId) {
      const result = await pool.query(`SELECT court_outcomes.* FROM court_outcomes JOIN court_runs ON court_runs.id = court_outcomes.run_id JOIN cases ON cases.id = court_runs.case_id WHERE court_outcomes.run_id = $1 AND ($2::text IS NULL OR cases.agent_id = $2) ORDER BY observed_at`, [runId, agentId ?? null]);
      return result.rows.map((row: Row) => ({ id: String(row.id), runId: String(row.run_id), agentId: String(row.agent_id), horizon: row.horizon as OutcomeRecord["horizon"], thesisOutcome: row.thesis_outcome as OutcomeRecord["thesisOutcome"], realizedReturnPct: row.realized_return_pct === null ? undefined : Number(row.realized_return_pct), note: row.note === null ? undefined : String(row.note), observedAt: iso(row.observed_at), recordedAt: iso(row.recorded_at) }));
    },

    async getJudgeCalibration(agentId) {
      const rows = await pool.query(`SELECT court_outcomes.thesis_outcome, ruling_reports.report FROM court_outcomes JOIN ruling_reports ON ruling_reports.run_id = court_outcomes.run_id JOIN court_runs ON court_runs.id = court_outcomes.run_id JOIN cases ON cases.id = court_runs.case_id WHERE cases.agent_id = $1`, [agentId]);
      const stats = new Map(["judge-risk", "judge-evidence", "judge-strategy"].map((judgeId) => [judgeId, { resolved: 0, correct: 0, incorrect: 0 }]));
      for (const row of rows.rows as Row[]) {
        if (row.thesis_outcome === "INCONCLUSIVE") continue;
        const report = rulingReportSchema.parse(row.report);
        for (const judge of report.judges) {
          if (!judge.vote || judge.vote === "ABSTAIN") continue;
          const stat = stats.get(judge.judgeId)!; stat.resolved += 1;
          const correct = (judge.vote === "APPROVE" && row.thesis_outcome === "CONFIRMED") || (judge.vote === "REJECT" && row.thesis_outcome === "REFUTED");
          if (correct) stat.correct += 1; else stat.incorrect += 1;
        }
      }
      return [...stats.entries()].map(([judgeId, stat]) => ({ judgeId: judgeId as JudgeCalibration["judgeId"], ...stat, accuracy: stat.resolved ? stat.correct / stat.resolved : null }));
    },

    async close() {
      await pool.end();
    },
  };
}
