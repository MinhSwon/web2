CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'USER',
  credits integer NOT NULL DEFAULT 10 CHECK (credits >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  topic text,
  status text NOT NULL DEFAULT 'DRAFT',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  sequence_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, object_key)
);

CREATE TABLE IF NOT EXISTS render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status job_status NOT NULL DEFAULT 'PENDING',
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  stage text NOT NULL DEFAULT 'pending',
  message text,
  output_key text,
  error_code text,
  idempotency_key text NOT NULL UNIQUE,
  refunded_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES render_jobs(id) ON DELETE SET NULL,
  kind text NOT NULL,
  credits integer NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_project_id ON project_assets(project_id, sequence_order);
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON render_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_project_id ON render_jobs(project_id, created_at DESC);

