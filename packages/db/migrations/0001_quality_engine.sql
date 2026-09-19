-- Quality engine: machine-readable evidence for every measurable property.

-- The page reader replaces classical OCR, so the column is renamed rather
-- than dropped and recreated: the historical values remain meaningful.
ALTER TABLE "file_versions" RENAME COLUMN "used_ocr" TO "used_vision";

-- Ingestion provenance and fidelity, recorded per file version.
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "verified_hash_at" timestamp with time zone;
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "declared_units" integer;
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "parsed_units" integer;
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "preview_units" integer;
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "low_confidence_units" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "index_coverage" real;
ALTER TABLE "file_versions" ADD COLUMN IF NOT EXISTS "processing_version" varchar(32);

CREATE TABLE IF NOT EXISTS "quality_evaluations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "metric_id" varchar(80) NOT NULL,
  "quality_spec_version" varchar(16) NOT NULL,
  "value" double precision NOT NULL,
  "status" varchar(8) NOT NULL,
  "severity" varchar(16) NOT NULL,
  "sample_size" integer DEFAULT 1 NOT NULL,
  "evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "repair_strategy" varchar(40) DEFAULT 'none' NOT NULL,
  "repair_attempted_at" timestamp with time zone,
  "repair_outcome" varchar(24),
  "value_after_repair" double precision,
  "workspace_id" uuid,
  "companion_id" uuid,
  "file_version_id" uuid,
  "release_id" varchar(64),
  "source" varchar(16) DEFAULT 'worker' NOT NULL,
  "measured_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "golden_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "key" varchar(80) NOT NULL,
  "companion_id" uuid,
  "question" text NOT NULL,
  "category" varchar(40) NOT NULL,
  "answerable" jsonb NOT NULL,
  "expected_evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "expected_value" varchar(200),
  "forbidden_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "attack_kind" varchar(40),
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "quality_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "release_id" varchar(64) NOT NULL,
  "quality_spec_version" varchar(16) NOT NULL,
  "kind" varchar(32) NOT NULL,
  "passed" jsonb NOT NULL,
  "blocking_failures" integer DEFAULT 0 NOT NULL,
  "warnings" integer DEFAULT 0 NOT NULL,
  "headline" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "summary" text,
  "duration_ms" integer,
  "started_at" timestamp with time zone NOT NULL,
  "finished_at" timestamp with time zone,
  "triggered_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "storage_integrity_checks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "storage_key" varchar(600) NOT NULL,
  "workspace_id" uuid,
  "file_version_id" uuid,
  "expected_size_bytes" integer NOT NULL,
  "observed_size_bytes" integer,
  "expected_hash" varchar(64),
  "observed_hash" varchar(64),
  "outcome" varchar(24) NOT NULL,
  "deep_verified" jsonb DEFAULT 'false'::jsonb NOT NULL,
  "checked_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "viewer_vitals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "companion_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "metric" varchar(16) NOT NULL,
  "value" real NOT NULL,
  "device_class" varchar(16),
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "quality_evaluations" ADD CONSTRAINT "quality_evaluations_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;
  ALTER TABLE "quality_evaluations" ADD CONSTRAINT "quality_evaluations_companion_id_companions_id_fk"
    FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade;
  ALTER TABLE "quality_evaluations" ADD CONSTRAINT "quality_evaluations_file_version_id_file_versions_id_fk"
    FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade;
  ALTER TABLE "golden_questions" ADD CONSTRAINT "golden_questions_companion_id_companions_id_fk"
    FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade;
  ALTER TABLE "quality_runs" ADD CONSTRAINT "quality_runs_triggered_by_user_id_users_id_fk"
    FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null;
  ALTER TABLE "storage_integrity_checks" ADD CONSTRAINT "storage_integrity_checks_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;
  ALTER TABLE "storage_integrity_checks" ADD CONSTRAINT "storage_integrity_checks_file_version_id_file_versions_id_fk"
    FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade;
  ALTER TABLE "viewer_vitals" ADD CONSTRAINT "viewer_vitals_companion_id_companions_id_fk"
    FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade;
  ALTER TABLE "viewer_vitals" ADD CONSTRAINT "viewer_vitals_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "quality_evaluations_metric_idx" ON "quality_evaluations" ("metric_id","measured_at");
CREATE INDEX IF NOT EXISTS "quality_evaluations_status_idx" ON "quality_evaluations" ("status","measured_at");
CREATE INDEX IF NOT EXISTS "quality_evaluations_companion_idx" ON "quality_evaluations" ("companion_id");
CREATE INDEX IF NOT EXISTS "quality_evaluations_release_idx" ON "quality_evaluations" ("release_id","metric_id");
CREATE INDEX IF NOT EXISTS "quality_evaluations_workspace_idx" ON "quality_evaluations" ("workspace_id","measured_at");
CREATE UNIQUE INDEX IF NOT EXISTS "golden_questions_key_key" ON "golden_questions" ("key");
CREATE INDEX IF NOT EXISTS "golden_questions_category_idx" ON "golden_questions" ("category");
CREATE INDEX IF NOT EXISTS "quality_runs_release_idx" ON "quality_runs" ("release_id");
CREATE INDEX IF NOT EXISTS "quality_runs_kind_idx" ON "quality_runs" ("kind","started_at");
CREATE INDEX IF NOT EXISTS "storage_integrity_key_idx" ON "storage_integrity_checks" ("storage_key","checked_at");
CREATE INDEX IF NOT EXISTS "storage_integrity_outcome_idx" ON "storage_integrity_checks" ("outcome","checked_at");
CREATE INDEX IF NOT EXISTS "viewer_vitals_metric_idx" ON "viewer_vitals" ("metric","occurred_at");
CREATE INDEX IF NOT EXISTS "viewer_vitals_companion_idx" ON "viewer_vitals" ("companion_id");

-- Analytics events gain an idempotency key so a retry, refresh or replay
-- cannot inflate a customer's numbers.
ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(120);
CREATE UNIQUE INDEX IF NOT EXISTS "analytics_events_idempotency_key"
  ON "analytics_events" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
