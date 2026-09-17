import { Pool } from "pg";
import type { AgentIdentity, AgentIdentityRepository, StoredAgentIdentity } from "./contracts.js";

type Row = Record<string, unknown>;

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
}

function fromRow(row: Row): AgentIdentity {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    capabilities: Array.isArray(row.capabilities) ? row.capabilities.map(String) : [],
    status: row.status as AgentIdentity["status"],
    keyPrefix: String(row.key_prefix),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    lastSeenAt: row.last_seen_at ? iso(row.last_seen_at) : null,
  };
}

export function createPostgresAgentIdentityRepository(options: {
  connectionString: string;
  ssl: boolean;
}): AgentIdentityRepository {
  const pool = new Pool({
    connectionString: options.connectionString,
    ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
  });

  return {
    name: "postgres",

    async createAgent(record: StoredAgentIdentity) {
      const result = await pool.query(
        `INSERT INTO agents
          (id, name, description, capabilities, status, key_hash, key_prefix, created_at, updated_at, last_seen_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          record.id,
          record.name,
          record.description,
          JSON.stringify(record.capabilities),
          record.status,
          record.keyHash,
          record.keyPrefix,
          record.createdAt,
          record.updatedAt,
          record.lastSeenAt,
        ],
      );
      return fromRow(result.rows[0] as Row);
    },

    async getAgentById(id) {
      const result = await pool.query("SELECT * FROM agents WHERE id = $1", [id]);
      return result.rowCount ? fromRow(result.rows[0] as Row) : null;
    },

    async getAgentByKeyHash(keyHash) {
      const result = await pool.query(
        "SELECT * FROM agents WHERE key_hash = $1 AND status = 'ACTIVE'",
        [keyHash],
      );
      return result.rowCount ? fromRow(result.rows[0] as Row) : null;
    },

    async updateLastSeen(id, lastSeenAt) {
      await pool.query("UPDATE agents SET last_seen_at = $2 WHERE id = $1", [id, lastSeenAt]);
    },

    async rotateKey(id, keyHash, keyPrefix, updatedAt) {
      const result = await pool.query(
        `UPDATE agents SET key_hash = $2, key_prefix = $3, updated_at = $4
         WHERE id = $1 AND status = 'ACTIVE' RETURNING *`,
        [id, keyHash, keyPrefix, updatedAt],
      );
      return result.rowCount ? fromRow(result.rows[0] as Row) : null;
    },

    async revokeAgent(id, updatedAt) {
      const result = await pool.query(
        `UPDATE agents SET status = 'REVOKED', updated_at = $2
         WHERE id = $1 RETURNING *`,
        [id, updatedAt],
      );
      return result.rowCount ? fromRow(result.rows[0] as Row) : null;
    },

    async close() {
      await pool.end();
    },
  };
}
