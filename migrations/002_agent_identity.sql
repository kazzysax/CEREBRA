CREATE TABLE IF NOT EXISTS agents (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  key_hash text NOT NULL UNIQUE,
  key_prefix text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  last_seen_at timestamptz
);

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS agent_id text REFERENCES agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS agents_status_idx ON agents (status, created_at DESC);
CREATE INDEX IF NOT EXISTS cases_agent_id_idx ON cases (agent_id, created_at DESC);
