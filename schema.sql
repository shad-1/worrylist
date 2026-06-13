-- Run in Supabase SQL editor

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE thoughts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_page_id text UNIQUE NOT NULL,
  content text NOT NULL,
  model text NOT NULL DEFAULT 'google/gemini-2.0-flash-lite',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_page_id text UNIQUE,
  title text NOT NULL,
  description text,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('english', title || ' ' || coalesce(description, ''))
  ) STORED,
  type text CHECK (type IN ('task','question','idea','concern','note')),
  urgency int CHECK (urgency BETWEEN 1 AND 10),
  importance int CHECK (importance BETWEEN 1 AND 10),
  want_done_at timestamptz,
  need_done_at timestamptz,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','scheduled','done','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tasks_search_idx ON tasks USING GIN(search_vector);

CREATE TABLE thought_tasks (
  thought_id uuid NOT NULL REFERENCES thoughts(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (thought_id, task_id)
);

CREATE TABLE runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thought_id uuid REFERENCES thoughts(id),
  trigger_type text NOT NULL
    CHECK (trigger_type IN ('classify','digest','recovery','manual')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','extracting','deduplicating','writing','validating','completed','failed')),
  failure_reason text,
  resumed_from_run_id uuid REFERENCES runs(id),
  worker_model text,
  turns_used int NOT NULL DEFAULT 0,
  tokens_in int NOT NULL DEFAULT 0,
  tokens_out int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE run_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('stage_transition','checkpoint','error')),
  stage text,
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alarm_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES runs(id),
  type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  context jsonb,
  recommended_action text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notion_page_id text UNIQUE,
  run_id uuid REFERENCES runs(id),
  type text NOT NULL CHECK (type IN ('error','approval_request','change_notification')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','acknowledged','approved','rejected')),
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

-- Update updated_at on task changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
