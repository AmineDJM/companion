-- The usage ledger is the record of what a customer was charged for. Granting
-- credit must add a row, never edit one, so the rule is enforced by the
-- database rather than by every caller remembering it.
ALTER TABLE usage_ledger
  ADD COLUMN IF NOT EXISTS pricing_version varchar(16) NOT NULL DEFAULT '2026.01';

CREATE OR REPLACE FUNCTION usage_ledger_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'usage_ledger is append-only: record an adjustment instead of editing row %',
    OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS usage_ledger_no_update ON usage_ledger;

-- DELETE is deliberately not guarded: removing a workspace must still cascade.
CREATE TRIGGER usage_ledger_no_update
  BEFORE UPDATE ON usage_ledger
  FOR EACH ROW EXECUTE FUNCTION usage_ledger_is_append_only();
