CREATE TABLE IF NOT EXISTS cases (
  id text PRIMARY KEY,
  proposal jsonb NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  evidence_mode text NOT NULL CHECK (evidence_mode IN ('BITGET', 'MANUAL')),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL CHECK (status IN ('READY', 'RUNNING', 'COMPLETED', 'FAILED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS court_runs (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  provider text NOT NULL,
  model text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  result jsonb,
  error text
);

CREATE TABLE IF NOT EXISTS ruling_reports (
  report_id text PRIMARY KEY,
  run_id text NOT NULL UNIQUE REFERENCES court_runs(id) ON DELETE CASCADE,
  status text NOT NULL,
  verdict text,
  report jsonb NOT NULL,
  markdown text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_outputs (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL REFERENCES court_runs(id) ON DELETE CASCADE,
  ordinal integer NOT NULL,
  stage text NOT NULL CHECK (stage IN ('ANALYST', 'CHALLENGER', 'JUDGE')),
  judge_id text,
  status text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  output jsonb NOT NULL,
  usage jsonb,
  error text,
  UNIQUE (run_id, ordinal)
);

CREATE INDEX IF NOT EXISTS cases_created_at_idx ON cases (created_at DESC);
CREATE INDEX IF NOT EXISTS court_runs_case_id_idx ON court_runs (case_id, started_at DESC);
CREATE INDEX IF NOT EXISTS agent_outputs_run_id_idx ON agent_outputs (run_id, ordinal);
