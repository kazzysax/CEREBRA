import { Pool } from "pg";
import type {
  AgentCheckpoint,
  AgentMemoryRepository,
  Impression,
  RecalledImpression,
  StrategyVersion,
} from "./contracts.js";

type Row = Record<string, unknown>;
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();

function strategyFromRow(row: Row): StrategyVersion {
  return {
    id: String(row.id), agentId: String(row.agent_id), asset: String(row.asset),
    timeframe: String(row.timeframe), thesis: String(row.thesis),
    constraints: Array.isArray(row.constraints) ? row.constraints.map(String) : [],
    invalidationConditions: Array.isArray(row.invalidation_conditions) ? row.invalidation_conditions.map(String) : [],
    parentVersionId: row.parent_version_id ? String(row.parent_version_id) : null,
    version: Number(row.version), status: row.status as StrategyVersion["status"],
    createdAt: iso(row.created_at), supersededAt: row.superseded_at ? iso(row.superseded_at) : null,
  };
}

function impressionFromRow(row: Row): Impression {
  return {
    id: String(row.id), agentId: String(row.agent_id),
    strategyVersionId: row.strategy_version_id ? String(row.strategy_version_id) : null,
    asset: String(row.asset), statement: String(row.statement), confidence: Number(row.confidence),
    evidenceIds: Array.isArray(row.evidence_ids) ? row.evidence_ids.map(String) : [],
    validUntil: row.valid_until ? iso(row.valid_until) : null,
    status: row.status as Impression["status"], createdAt: iso(row.created_at),
    supersededAt: row.superseded_at ? iso(row.superseded_at) : null,
  };
}

function checkpointFromRow(row: Row): AgentCheckpoint {
  return {
    id: String(row.id), agentId: String(row.agent_id),
    strategyVersionId: row.strategy_version_id ? String(row.strategy_version_id) : null,
    schemaVersion: String(row.schema_version), state: row.state as Record<string, unknown>,
    lastAcknowledgedActionId: row.last_acknowledged_action_id ? String(row.last_acknowledged_action_id) : null,
    reconciliationRequired: Boolean(row.reconciliation_required), createdAt: iso(row.created_at),
  };
}

export function createPostgresAgentMemoryRepository(options: { connectionString: string; ssl: boolean }): AgentMemoryRepository {
  const pool = new Pool({ connectionString: options.connectionString, ssl: options.ssl ? { rejectUnauthorized: false } : undefined });
  return {
    name: "postgres",
    async createStrategy(record) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (record.parentVersionId) {
          const parent = await client.query(
            "SELECT id FROM strategy_versions WHERE id = $1 AND agent_id = $2 FOR UPDATE",
            [record.parentVersionId, record.agentId],
          );
          if (!parent.rowCount) throw new Error("PARENT_STRATEGY_NOT_FOUND");
        }
        const versionResult = await client.query(
          "SELECT COALESCE(MAX(version), 0) + 1 AS version FROM strategy_versions WHERE agent_id = $1 AND asset = $2",
          [record.agentId, record.asset],
        );
        const version = Number((versionResult.rows[0] as Row).version);
        await client.query(
          "UPDATE strategy_versions SET status = 'SUPERSEDED', superseded_at = $3 WHERE agent_id = $1 AND asset = $2 AND status = 'ACTIVE'",
          [record.agentId, record.asset, record.createdAt],
        );
        const result = await client.query(
          `INSERT INTO strategy_versions
            (id, agent_id, asset, timeframe, thesis, constraints, invalidation_conditions, parent_version_id, version, status, created_at)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,'ACTIVE',$10) RETURNING *`,
          [record.id, record.agentId, record.asset, record.timeframe, record.thesis,
            JSON.stringify(record.constraints), JSON.stringify(record.invalidationConditions),
            record.parentVersionId, version, record.createdAt],
        );
        await client.query("COMMIT");
        return strategyFromRow(result.rows[0] as Row);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
    async listStrategies(agentId, limit) {
      const result = await pool.query(
        "SELECT * FROM strategy_versions WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2",
        [agentId, limit],
      );
      return result.rows.map((row) => strategyFromRow(row as Row));
    },
    async getStrategy(id, agentId) {
      const result = await pool.query("SELECT * FROM strategy_versions WHERE id = $1 AND agent_id = $2", [id, agentId]);
      return result.rowCount ? strategyFromRow(result.rows[0] as Row) : null;
    },
    async createImpression(record) {
      const result = await pool.query(
        `INSERT INTO impressions
          (id, agent_id, strategy_version_id, asset, statement, confidence, evidence_ids, valid_until, status, created_at)
         SELECT $1,$2,$3,$4,$5,$6,$7::jsonb,$8,'ACTIVE',$9
         WHERE $3::text IS NULL OR EXISTS (SELECT 1 FROM strategy_versions WHERE id = $3 AND agent_id = $2)
         RETURNING *`,
        [record.id, record.agentId, record.strategyVersionId, record.asset, record.statement,
          record.confidence, JSON.stringify(record.evidenceIds), record.validUntil, record.createdAt],
      );
      if (!result.rowCount) throw new Error("STRATEGY_NOT_FOUND");
      return impressionFromRow(result.rows[0] as Row);
    },
    async recallImpressions(agentId, asset, limit, now): Promise<RecalledImpression[]> {
      const result = await pool.query(
        "SELECT *, (valid_until IS NOT NULL AND valid_until <= $4) AS is_expired FROM impressions WHERE agent_id = $1 AND asset = $2 ORDER BY created_at DESC LIMIT $3",
        [agentId, asset, limit, now],
      );
      return result.rows.map((row) => ({ ...impressionFromRow(row as Row), isExpired: Boolean(row.is_expired) }));
    },
    async createCheckpoint(record) {
      const result = await pool.query(
        `INSERT INTO agent_checkpoints
          (id, agent_id, strategy_version_id, schema_version, state, last_acknowledged_action_id, reconciliation_required, created_at)
         SELECT $1,$2,$3,$4,$5::jsonb,$6,$7,$8
         WHERE $3::text IS NULL OR EXISTS (SELECT 1 FROM strategy_versions WHERE id = $3 AND agent_id = $2)
         RETURNING *`,
        [record.id, record.agentId, record.strategyVersionId, record.schemaVersion,
          JSON.stringify(record.state), record.lastAcknowledgedActionId, record.reconciliationRequired, record.createdAt],
      );
      if (!result.rowCount) throw new Error("STRATEGY_NOT_FOUND");
      return checkpointFromRow(result.rows[0] as Row);
    },
    async getLatestCheckpoint(agentId, strategyVersionId) {
      const result = strategyVersionId === undefined
        ? await pool.query("SELECT * FROM agent_checkpoints WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1", [agentId])
        : await pool.query("SELECT * FROM agent_checkpoints WHERE agent_id = $1 AND strategy_version_id IS NOT DISTINCT FROM $2 ORDER BY created_at DESC LIMIT 1", [agentId, strategyVersionId]);
      return result.rowCount ? checkpointFromRow(result.rows[0] as Row) : null;
    },
    async close() { await pool.end(); },
  };
}
