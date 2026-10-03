-- Public, append-only ledger of court rulings shown on the site. Each row's
-- entry_hash covers the previous row's hash, so editing or removing a past row
-- is detectable by anyone holding an earlier head hash. The report is stored as
-- a snapshot so its digest stays verifiable even if the report schema changes.
CREATE TABLE IF NOT EXISTS public_ledger (
  seq bigint PRIMARY KEY,
  slot_key text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('RULED', 'MISSED')),
  source text NOT NULL CHECK (source IN ('SCHEDULED', 'BACKFILL')),
  asset text,
  timeframe text,
  risk_level text,
  model text,
  run_id text UNIQUE REFERENCES court_runs(id) ON DELETE RESTRICT,
  ruled_at timestamptz NOT NULL,
  report jsonb,
  report_digest text,
  missed_reason text,
  prev_hash text NOT NULL,
  entry_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  score jsonb
);
CREATE INDEX IF NOT EXISTS public_ledger_ruled_at_idx ON public_ledger (ruled_at DESC);
