-- Automatic outcome resolution: outcomes can now be recorded by the court
-- itself (source AUTO) for anonymous as well as agent-owned runs.
ALTER TABLE court_outcomes ALTER COLUMN agent_id DROP NOT NULL;
ALTER TABLE court_outcomes ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'AGENT';
ALTER TABLE court_outcomes DROP CONSTRAINT IF EXISTS court_outcomes_source_check;
ALTER TABLE court_outcomes ADD CONSTRAINT court_outcomes_source_check CHECK (source IN ('AGENT', 'AUTO'));
ALTER TABLE court_outcomes DROP CONSTRAINT IF EXISTS court_outcomes_horizon_check;
ALTER TABLE court_outcomes ADD CONSTRAINT court_outcomes_horizon_check CHECK (horizon IN ('15m', '1h', '4h', '24h', '7d'));
CREATE INDEX IF NOT EXISTS court_outcomes_run_idx ON court_outcomes (run_id);
