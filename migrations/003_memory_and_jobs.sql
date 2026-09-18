CREATE TABLE IF NOT EXISTS strategy_versions (
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  asset text NOT NULL,
  timeframe text NOT NULL,
  thesis text NOT NULL,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  invalidation_conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  parent_version_id text REFERENCES strategy_versions(id) ON DELETE SET NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  created_at timestamptz NOT NULL,
  superseded_at timestamptz,
  UNIQUE (agent_id, asset, version)
);

CREATE TABLE IF NOT EXISTS impressions (
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  strategy_version_id text REFERENCES strategy_versions(id) ON DELETE SET NULL,
  asset text NOT NULL,
  statement text NOT NULL,
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  valid_until timestamptz,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'SUPERSEDED')),
  created_at timestamptz NOT NULL,
  superseded_at timestamptz
);

CREATE TABLE IF NOT EXISTS agent_checkpoints (
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  strategy_version_id text REFERENCES strategy_versions(id) ON DELETE SET NULL,
  schema_version text NOT NULL,
  state jsonb NOT NULL,
  last_acknowledged_action_id text,
  reconciliation_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS court_jobs (
  id text PRIMARY KEY,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  case_id text NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  run_id text REFERENCES court_runs(id) ON DELETE SET NULL,
  idempotency_key text,
  refresh_evidence boolean NOT NULL DEFAULT true,
  status text NOT NULL CHECK (status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  stage text NOT NULL CHECK (stage IN ('QUEUED', 'CLAIMED', 'EVIDENCE', 'ANALYST', 'PERSISTING', 'COMPLETED', 'RETRYING', 'FAILED', 'CANCELLED')),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  generation integer NOT NULL DEFAULT 0,
  lease_owner text,
  lease_expires_at timestamptz,
  error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS court_jobs_agent_idempotency_idx
  ON court_jobs (agent_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS strategy_versions_agent_asset_idx ON strategy_versions (agent_id, asset, created_at DESC);
CREATE INDEX IF NOT EXISTS impressions_agent_asset_idx ON impressions (agent_id, asset, created_at DESC);
CREATE INDEX IF NOT EXISTS checkpoints_agent_strategy_idx ON agent_checkpoints (agent_id, strategy_version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS court_jobs_claim_idx ON court_jobs (status, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS court_jobs_agent_idx ON court_jobs (agent_id, created_at DESC);
