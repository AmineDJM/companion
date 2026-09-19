-- Every analytics event now carries a key, generated server-side when the
-- caller has no stable id of its own. A partial unique index cannot be named
-- in an ON CONFLICT clause without repeating its predicate, which is how a
-- broken insert managed to drop every event silently; an unconditional index
-- removes that footgun and makes "a key is required" a database fact.
UPDATE analytics_events
  SET idempotency_key = gen_random_uuid()::text
  WHERE idempotency_key IS NULL;

DROP INDEX IF EXISTS "analytics_events_idempotency_key";

ALTER TABLE analytics_events
  ALTER COLUMN idempotency_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "analytics_events_idempotency_key"
  ON analytics_events ("idempotency_key");
