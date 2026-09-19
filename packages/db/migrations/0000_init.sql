CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_agent" varchar(400),
	"ip_hash" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" varchar(254) NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"payload" jsonb,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"email_verified_at" timestamp with time zone,
	"name" varchar(160),
	"avatar_url" text,
	"password_hash" text,
	"platform_role" varchar(20) DEFAULT 'user' NOT NULL,
	"google_subject" varchar(128),
	"last_seen_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"invited_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"owner_id" uuid NOT NULL,
	"plan_key" varchar(32) DEFAULT 'free' NOT NULL,
	"plan_override_key" varchar(32),
	"plan_override_expires_at" timestamp with time zone,
	"plan_override_reason" varchar(500),
	"entitlement_overrides" jsonb,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_reason" varchar(500),
	"uploads_disabled" boolean DEFAULT false NOT NULL,
	"ai_disabled" boolean DEFAULT false NOT NULL,
	"stripe_customer_id" varchar(64),
	"billing_anchor_at" timestamp with time zone DEFAULT now() NOT NULL,
	"storage_bytes_used" integer DEFAULT 0 NOT NULL,
	"branding" jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"subscription_id" uuid,
	"stripe_invoice_id" varchar(64),
	"stripe_payment_intent_id" varchar(64),
	"stripe_customer_id" varchar(64),
	"amount_due_cents" integer DEFAULT 0 NOT NULL,
	"amount_paid_cents" integer DEFAULT 0 NOT NULL,
	"currency" varchar(8) DEFAULT 'eur' NOT NULL,
	"status" varchar(32) NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"failure_message" varchar(500),
	"next_retry_at" timestamp with time zone,
	"hosted_invoice_url" text,
	"paid_at" timestamp with time zone,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(32) NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"tagline" varchar(300) DEFAULT '' NOT NULL,
	"monthly_price_cents" integer DEFAULT 0 NOT NULL,
	"annual_price_cents" integer DEFAULT 0 NOT NULL,
	"currency" varchar(8) DEFAULT 'eur' NOT NULL,
	"stripe_product_id" varchar(64),
	"stripe_monthly_price_id" varchar(64),
	"stripe_annual_price_id" varchar(64),
	"entitlements" jsonb NOT NULL,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"type" varchar(100) NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"payload_digest" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"plan_key" varchar(32) NOT NULL,
	"interval" varchar(16) NOT NULL,
	"status" varchar(32) NOT NULL,
	"stripe_subscription_id" varchar(64),
	"stripe_customer_id" varchar(64),
	"stripe_price_id" varchar(64),
	"amount_cents" integer DEFAULT 0 NOT NULL,
	"currency" varchar(8) DEFAULT 'eur' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"grace_days" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" varchar(32) NOT NULL,
	"amount" integer NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_by_user_id" uuid,
	"recurring" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(48) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"questions" integer NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'eur' NOT NULL,
	"stripe_price_id" varchar(64),
	"validity_days" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"pack_key" varchar(48) NOT NULL,
	"questions" integer NOT NULL,
	"amount_paid_cents" integer DEFAULT 0 NOT NULL,
	"currency" varchar(8) DEFAULT 'eur' NOT NULL,
	"stripe_invoice_id" varchar(64),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"file_version_id" uuid NOT NULL,
	"unit_id" uuid,
	"ordinal" integer NOT NULL,
	"text" text NOT NULL,
	"token_estimate" integer DEFAULT 0 NOT NULL,
	"file_name" varchar(400) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"page" integer,
	"slide" integer,
	"sheet_name" varchar(200),
	"section_title" varchar(500),
	"range" varchar(64),
	"embedding" vector(1536),
	"embedding_model" varchar(64),
	"content_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companion_access_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid NOT NULL,
	"password_hash" text,
	"allowed_emails" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"require_identity" boolean DEFAULT false NOT NULL,
	"notify_on_open" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companion_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"companion_id" uuid,
	"hostname" varchar(253) NOT NULL,
	"path_prefix" varchar(120),
	"verification_token" varchar(64) NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"name" varchar(160) NOT NULL,
	"slug" varchar(24) NOT NULL,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"default_file_id" uuid,
	"download_allowed" boolean DEFAULT false NOT NULL,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"source_protection_mode" varchar(16) DEFAULT 'STANDARD' NOT NULL,
	"access_mode" varchar(20) DEFAULT 'PUBLIC' NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"branding" jsonb,
	"view_count" integer DEFAULT 0 NOT NULL,
	"visitor_count" integer DEFAULT 0 NOT NULL,
	"question_count" integer DEFAULT 0 NOT NULL,
	"unanswered_count" integer DEFAULT 0 NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"storage_bytes" bigint DEFAULT 0 NOT NULL,
	"indexed_units" integer DEFAULT 0 NOT NULL,
	"indexed_chunks" integer DEFAULT 0 NOT NULL,
	"processing_progress" integer DEFAULT 0 NOT NULL,
	"processing_step" varchar(32),
	"processing_error" text,
	"last_opened_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"purge_after_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"file_version_id" uuid NOT NULL,
	"kind" varchar(16) NOT NULL,
	"ordinal" integer NOT NULL,
	"page" integer,
	"slide" integer,
	"sheet_name" varchar(200),
	"section_title" varchar(500),
	"range" varchar(64),
	"text" text DEFAULT '' NOT NULL,
	"character_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"companion_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" varchar(600) NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"original_filename" varchar(400) NOT NULL,
	"page_count" integer,
	"indexed_at" timestamp with time zone,
	"used_ocr" boolean DEFAULT false NOT NULL,
	"text_characters" integer DEFAULT 0 NOT NULL,
	"uploaded_by_user_id" uuid,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid NOT NULL,
	"folder_id" uuid,
	"source_archive_file_id" uuid,
	"name" varchar(400) NOT NULL,
	"path" varchar(2000) NOT NULL,
	"kind" varchar(20) DEFAULT 'UNKNOWN' NOT NULL,
	"extension" varchar(16) DEFAULT '' NOT NULL,
	"mime_type" varchar(160) DEFAULT 'application/octet-stream' NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"status_message" varchar(500),
	"current_version_id" uuid,
	"version_count" integer DEFAULT 0 NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"page_count" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_container" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" varchar(400) NOT NULL,
	"path" varchar(2000) NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "preview_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_version_id" uuid NOT NULL,
	"companion_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"page" integer,
	"storage_key" varchar(600) NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"width" integer,
	"height" integer,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid,
	"workspace_id" uuid,
	"file_id" uuid,
	"file_version_id" uuid,
	"type" varchar(40) NOT NULL,
	"status" varchar(20) DEFAULT 'QUEUED' NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"queue_job_id" varchar(120),
	"priority" integer DEFAULT 0 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"error" text,
	"payload" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retrieval_diagnostics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"companion_id" uuid NOT NULL,
	"top_score" real DEFAULT 0 NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"context_tokens" integer DEFAULT 0 NOT NULL,
	"file_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"complex" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"name" varchar(160),
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"claimed_by_workspace_id" uuid,
	"claimed_companion_id" uuid,
	"claimed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"recipient_session_id" uuid,
	"type" varchar(40) NOT NULL,
	"file_id" uuid,
	"page" integer,
	"duration_ms" integer,
	"metadata" jsonb,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"companion_id" uuid NOT NULL,
	"text" text NOT NULL,
	"answered" boolean DEFAULT true NOT NULL,
	"refusal_kind" varchar(32) DEFAULT 'none' NOT NULL,
	"confidence" real,
	"model" varchar(64),
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "citations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"companion_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"file_version_id" uuid NOT NULL,
	"unit_id" uuid,
	"chunk_id" uuid,
	"page" integer,
	"slide" integer,
	"sheet_name" varchar(200),
	"range" varchar(64),
	"section_title" varchar(500),
	"quote" text,
	"relevance" real DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"opened_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid NOT NULL,
	"recipient_session_id" uuid NOT NULL,
	"started_against_versions" jsonb,
	"question_count" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid NOT NULL,
	"label" varchar(120) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"question_count" integer DEFAULT 0 NOT NULL,
	"unanswered_count" integer DEFAULT 0 NOT NULL,
	"example_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"insight" text,
	"centroid" jsonb,
	"last_question_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"companion_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"recipient_session_id" uuid NOT NULL,
	"text" text NOT NULL,
	"context_file_id" uuid,
	"context_page" integer,
	"context_sheet" varchar(200),
	"has_selection" boolean DEFAULT false NOT NULL,
	"protection_intent" varchar(32),
	"protection_score" real,
	"blocked_by_protection" boolean DEFAULT false NOT NULL,
	"topic_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipient_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid NOT NULL,
	"email" varchar(254) NOT NULL,
	"name" varchar(160),
	"verified_at" timestamp with time zone,
	"code_hash" varchar(64),
	"code_expires_at" timestamp with time zone,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"visit_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipient_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"companion_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"password_verified_at" timestamp with time zone,
	"verified_email" varchar(254),
	"identity_id" uuid,
	"ip_hash" varchar(64),
	"user_agent_family" varchar(60),
	"country_code" varchar(2),
	"question_count" integer DEFAULT 0 NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"extraction_attempts" integer DEFAULT 0 NOT NULL,
	"quoted_characters" integer DEFAULT 0 NOT NULL,
	"quoted_unit_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answers_delivered" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_label" varchar(254),
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"actor_user_id" uuid,
	"actor_type" varchar(20) DEFAULT 'user' NOT NULL,
	"actor_label" varchar(254),
	"action" varchar(80) NOT NULL,
	"target_type" varchar(40),
	"target_id" varchar(64),
	"target_label" varchar(300),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(64) NOT NULL,
	"description" varchar(500),
	"enabled_globally" boolean DEFAULT false NOT NULL,
	"enabled_plans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled_workspace_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" varchar(16) PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"limits" jsonb NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(40) NOT NULL,
	"capability" varchar(40) NOT NULL,
	"healthy" boolean NOT NULL,
	"latency_ms" integer,
	"message" varchar(300),
	"checked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_reclamations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"storage_key" varchar(600) NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"reason" varchar(80) NOT NULL,
	"delete_after_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_daily_rollups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" varchar(10) NOT NULL,
	"workspace_id" uuid,
	"questions" integer DEFAULT 0 NOT NULL,
	"answers" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"cached_input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"answer_cost_usd" double precision DEFAULT 0 NOT NULL,
	"embedding_cost_usd" double precision DEFAULT 0 NOT NULL,
	"total_cost_usd" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"companion_id" uuid,
	"recipient_session_id" uuid,
	"question_id" uuid,
	"provider" varchar(40) NOT NULL,
	"model" varchar(64) NOT NULL,
	"request_kind" varchar(32) NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" double precision DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"succeeded" boolean DEFAULT true NOT NULL,
	"billable" boolean DEFAULT false NOT NULL,
	"error_code" varchar(64),
	"request_id" varchar(120),
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"id" varchar(120) PRIMARY KEY NOT NULL,
	"hostname" varchar(200),
	"version" varchar(40),
	"queues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_jobs" integer DEFAULT 0 NOT NULL,
	"completed_jobs" bigint DEFAULT 0 NOT NULL,
	"failed_jobs" bigint DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_beat_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_adjustments" ADD CONSTRAINT "usage_adjustments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_adjustments" ADD CONSTRAINT "usage_adjustments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_purchases" ADD CONSTRAINT "usage_purchases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_unit_id_document_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."document_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_access_policies" ADD CONSTRAINT "companion_access_policies_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_domains" ADD CONSTRAINT "companion_domains_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companion_domains" ADD CONSTRAINT "companion_domains_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companions" ADD CONSTRAINT "companions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companions" ADD CONSTRAINT "companions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_units" ADD CONSTRAINT "document_units_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_units" ADD CONSTRAINT "document_units_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_units" ADD CONSTRAINT "document_units_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_artifacts" ADD CONSTRAINT "preview_artifacts_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preview_artifacts" ADD CONSTRAINT "preview_artifacts_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_file_version_id_file_versions_id_fk" FOREIGN KEY ("file_version_id") REFERENCES "public"."file_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retrieval_diagnostics" ADD CONSTRAINT "retrieval_diagnostics_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_drafts" ADD CONSTRAINT "upload_drafts_claimed_by_workspace_id_workspaces_id_fk" FOREIGN KEY ("claimed_by_workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_drafts" ADD CONSTRAINT "upload_drafts_claimed_companion_id_companions_id_fk" FOREIGN KEY ("claimed_companion_id") REFERENCES "public"."companions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_recipient_session_id_recipient_sessions_id_fk" FOREIGN KEY ("recipient_session_id") REFERENCES "public"."recipient_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_unit_id_document_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."document_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "citations" ADD CONSTRAINT "citations_chunk_id_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_recipient_session_id_recipient_sessions_id_fk" FOREIGN KEY ("recipient_session_id") REFERENCES "public"."recipient_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_topics" ADD CONSTRAINT "question_topics_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_recipient_session_id_recipient_sessions_id_fk" FOREIGN KEY ("recipient_session_id") REFERENCES "public"."recipient_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_context_file_id_files_id_fk" FOREIGN KEY ("context_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_identities" ADD CONSTRAINT "recipient_identities_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipient_sessions" ADD CONSTRAINT "recipient_sessions_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_notes" ADD CONSTRAINT "admin_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_reclamations" ADD CONSTRAINT "storage_reclamations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily_rollups" ADD CONSTRAINT "usage_daily_rollups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_companion_id_companions_id_fk" FOREIGN KEY ("companion_id") REFERENCES "public"."companions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_tokens_hash_key" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "auth_tokens_email_idx" ON "auth_tokens" USING btree ("email");--> statement-breakpoint
CREATE INDEX "auth_tokens_expires_idx" ON "auth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_subject_key" ON "users" USING btree ("google_subject");--> statement-breakpoint
CREATE INDEX "users_platform_role_idx" ON "users" USING btree ("platform_role");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_unique" ON "workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_stripe_customer_key" ON "workspaces" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "workspaces_owner_idx" ON "workspaces" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "workspaces_plan_idx" ON "workspaces" USING btree ("plan_key");--> statement-breakpoint
CREATE INDEX "workspaces_status_idx" ON "workspaces" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_invoice_key" ON "payments" USING btree ("stripe_invoice_id");--> statement-breakpoint
CREATE INDEX "payments_workspace_idx" ON "payments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_occurred_idx" ON "payments" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_key_key" ON "plans" USING btree ("key");--> statement-breakpoint
CREATE INDEX "plans_sort_idx" ON "plans" USING btree ("sort_order");--> statement-breakpoint
CREATE INDEX "stripe_events_type_idx" ON "stripe_events" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_stripe_key" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_workspace_idx" ON "subscriptions" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "usage_adjustments_workspace_idx" ON "usage_adjustments" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "usage_adjustments_created_idx" ON "usage_adjustments" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_packs_key_key" ON "usage_packs" USING btree ("key");--> statement-breakpoint
CREATE INDEX "usage_purchases_workspace_idx" ON "usage_purchases" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "usage_purchases_created_idx" ON "usage_purchases" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_version_ordinal_key" ON "chunks" USING btree ("file_version_id","ordinal");--> statement-breakpoint
CREATE INDEX "chunks_companion_idx" ON "chunks" USING btree ("companion_id");--> statement-breakpoint
CREATE INDEX "chunks_file_version_idx" ON "chunks" USING btree ("file_version_id");--> statement-breakpoint
CREATE INDEX "chunks_hash_idx" ON "chunks" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "chunks_fts_idx" ON "chunks" USING gin (to_tsvector('english', "text"));--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "companion_access_policies_companion_key" ON "companion_access_policies" USING btree ("companion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companion_domains_hostname_key" ON "companion_domains" USING btree ("hostname","path_prefix");--> statement-breakpoint
CREATE INDEX "companion_domains_workspace_idx" ON "companion_domains" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "companions_slug_key" ON "companions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "companions_workspace_idx" ON "companions" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "companions_status_idx" ON "companions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "companions_expires_idx" ON "companions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "companions_name_search_idx" ON "companions" USING gin (to_tsvector('simple', "name"));--> statement-breakpoint
CREATE UNIQUE INDEX "document_units_version_ordinal_key" ON "document_units" USING btree ("file_version_id","ordinal");--> statement-breakpoint
CREATE INDEX "document_units_file_idx" ON "document_units" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "document_units_companion_idx" ON "document_units" USING btree ("companion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_versions_file_version_key" ON "file_versions" USING btree ("file_id","version");--> statement-breakpoint
CREATE INDEX "file_versions_companion_idx" ON "file_versions" USING btree ("companion_id");--> statement-breakpoint
CREATE INDEX "file_versions_hash_idx" ON "file_versions" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "files_companion_idx" ON "files" USING btree ("companion_id","sort_order");--> statement-breakpoint
CREATE INDEX "files_status_idx" ON "files" USING btree ("status");--> statement-breakpoint
CREATE INDEX "files_folder_idx" ON "files" USING btree ("folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "folders_companion_path_key" ON "folders" USING btree ("companion_id","path");--> statement-breakpoint
CREATE INDEX "folders_parent_idx" ON "folders" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "preview_artifacts_unique" ON "preview_artifacts" USING btree ("file_version_id","kind","page");--> statement-breakpoint
CREATE INDEX "preview_artifacts_companion_idx" ON "preview_artifacts" USING btree ("companion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "processing_jobs_idempotency_key" ON "processing_jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "processing_jobs_companion_idx" ON "processing_jobs" USING btree ("companion_id");--> statement-breakpoint
CREATE INDEX "processing_jobs_status_idx" ON "processing_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "processing_jobs_type_idx" ON "processing_jobs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "retrieval_diagnostics_companion_idx" ON "retrieval_diagnostics" USING btree ("companion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_drafts_token_key" ON "upload_drafts" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "upload_drafts_expires_idx" ON "upload_drafts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "analytics_events_companion_idx" ON "analytics_events" USING btree ("companion_id","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_workspace_idx" ON "analytics_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_type_idx" ON "analytics_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "analytics_events_file_idx" ON "analytics_events" USING btree ("file_id");--> statement-breakpoint
CREATE UNIQUE INDEX "answers_question_key" ON "answers" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "answers_companion_idx" ON "answers" USING btree ("companion_id");--> statement-breakpoint
CREATE INDEX "citations_answer_idx" ON "citations" USING btree ("answer_id","position");--> statement-breakpoint
CREATE INDEX "citations_file_idx" ON "citations" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "conversations_companion_idx" ON "conversations" USING btree ("companion_id");--> statement-breakpoint
CREATE INDEX "conversations_session_idx" ON "conversations" USING btree ("recipient_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "question_topics_unique" ON "question_topics" USING btree ("companion_id","slug");--> statement-breakpoint
CREATE INDEX "question_topics_count_idx" ON "question_topics" USING btree ("companion_id","question_count");--> statement-breakpoint
CREATE INDEX "questions_companion_idx" ON "questions" USING btree ("companion_id","created_at");--> statement-breakpoint
CREATE INDEX "questions_workspace_idx" ON "questions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "questions_session_idx" ON "questions" USING btree ("recipient_session_id");--> statement-breakpoint
CREATE INDEX "questions_topic_idx" ON "questions" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recipient_identities_unique" ON "recipient_identities" USING btree ("companion_id","email");--> statement-breakpoint
CREATE INDEX "recipient_identities_email_idx" ON "recipient_identities" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "recipient_sessions_token_key" ON "recipient_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "recipient_sessions_companion_idx" ON "recipient_sessions" USING btree ("companion_id","first_seen_at");--> statement-breakpoint
CREATE INDEX "recipient_sessions_email_idx" ON "recipient_sessions" USING btree ("verified_email");--> statement-breakpoint
CREATE INDEX "admin_notes_workspace_idx" ON "admin_notes" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_workspace_idx" ON "audit_logs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags" USING btree ("key");--> statement-breakpoint
CREATE INDEX "provider_health_provider_idx" ON "provider_health" USING btree ("provider","checked_at");--> statement-breakpoint
CREATE INDEX "provider_health_checked_idx" ON "provider_health" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "storage_reclamations_pending_idx" ON "storage_reclamations" USING btree ("deleted_at","delete_after_at");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_reclamations_key_key" ON "storage_reclamations" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_daily_rollups_unique" ON "usage_daily_rollups" USING btree ("day","workspace_id");--> statement-breakpoint
CREATE INDEX "usage_daily_rollups_day_idx" ON "usage_daily_rollups" USING btree ("day");--> statement-breakpoint
CREATE INDEX "usage_ledger_workspace_idx" ON "usage_ledger" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_ledger_companion_idx" ON "usage_ledger" USING btree ("companion_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_ledger_kind_idx" ON "usage_ledger" USING btree ("request_kind","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_ledger_model_idx" ON "usage_ledger" USING btree ("model");--> statement-breakpoint
CREATE INDEX "usage_ledger_billable_idx" ON "usage_ledger" USING btree ("workspace_id","billable","occurred_at");--> statement-breakpoint
CREATE INDEX "worker_heartbeats_beat_idx" ON "worker_heartbeats" USING btree ("last_beat_at");