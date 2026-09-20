CREATE TABLE IF NOT EXISTS court_outcomes (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES court_runs(id) ON DELETE CASCADE,
  agent_id text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  horizon text NOT NULL CHECK (horizon IN ('1h', '4h', '24h', '7d')),
  thesis_outcome text NOT NULL CHECK (thesis_outcome IN ('CONFIRMED', 'REFUTED', 'INCONCLUSIVE')),
  realized_return_pct double precision,
  note text,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL,
  UNIQUE (run_id, horizon)
);
CREATE INDEX IF NOT EXISTS court_outcomes_agent_idx ON court_outcomes (agent_id, observed_at DESC);
