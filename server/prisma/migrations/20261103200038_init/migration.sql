-- CreateTable
CREATE TABLE "analysis_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "owner" TEXT NOT NULL,
    "repo" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "repo_name" TEXT NOT NULL,
    "display_url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "tech_stack" JSONB,
    "codebase_analysis" JSONB,
    "messages" JSONB,
    "errors" JSONB,
    "last_progress" JSONB,
    "verification_results" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cloned_at" TIMESTAMPTZ(6),
    "analysis_started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "analysis_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_files" (
    "session_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_files_pkey" PRIMARY KEY ("session_id","kind")
);

-- CreateTable (id edited by hand: identity column instead of bigserial)
CREATE TABLE "ai_calls" (
    "id" BIGINT GENERATED ALWAYS AS IDENTITY,
    "session_id" UUID,
    "user_id" UUID,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "http_status" INTEGER,
    "latency_ms" INTEGER NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analysis_sessions_user_id_created_at_idx" ON "analysis_sessions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "analysis_sessions_expires_at_idx" ON "analysis_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "analysis_sessions_status_idx" ON "analysis_sessions"("status");

-- CreateIndex
CREATE INDEX "ai_calls_created_at_idx" ON "ai_calls"("created_at");

-- AddForeignKey
ALTER TABLE "generated_files" ADD CONSTRAINT "generated_files_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "analysis_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "analysis_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written additions (not expressible in schema.prisma)

-- Data checks
ALTER TABLE "analysis_sessions" ADD CONSTRAINT "analysis_sessions_status_check"
  CHECK ("status" IN ('cloning', 'cloned', 'analyzing', 'completed', 'failed'));
ALTER TABLE "generated_files" ADD CONSTRAINT "generated_files_content_length_check"
  CHECK (length("content") <= 200000);

-- Lock the server's tables away from Supabase's browser-facing Data API.
-- The server connects as the table owner, which bypasses RLS; the anon and
-- authenticated roles get RLS with no policies (they see nothing) and no privileges,
-- including those Supabase's default privileges grant on new tables and sequences.
-- `prisma migrate deploy` creates _prisma_migrations before it runs this SQL, so the
-- migrations table is locked here too. Plain Postgres has no anon/authenticated roles,
-- so the revokes check pg_roles first: this file applies to both unchanged.
ALTER TABLE "analysis_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "generated_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_calls" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  browser_role text;
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY';
  END IF;

  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.analysis_sessions, public.generated_files, public.ai_calls FROM %I', browser_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE public.ai_calls_id_seq FROM %I', browser_role);
      IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
        EXECUTE format('REVOKE ALL ON TABLE public._prisma_migrations FROM %I', browser_role);
      END IF;
    END IF;
  END LOOP;
END
$$;
