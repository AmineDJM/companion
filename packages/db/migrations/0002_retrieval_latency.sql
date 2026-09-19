-- Retrieval latency is measured separately from answer latency: a slow search
-- and a slow model need different fixes, and one must not hide behind the other.
ALTER TABLE retrieval_diagnostics
  ADD COLUMN IF NOT EXISTS latency_ms integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS retrieval_diagnostics_created_idx
  ON retrieval_diagnostics (created_at);
