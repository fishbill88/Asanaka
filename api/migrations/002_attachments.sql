-- Files and images attached to a task. They live in the database, so the nightly pg_dump backs them up
-- with everything else. Each file is at most 10 MB (the API and Caddy both enforce it).

CREATE TABLE attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  uploader_id  uuid NOT NULL REFERENCES users (id),
  filename     text NOT NULL,
  content_type text NOT NULL,
  size         integer NOT NULL,
  data         bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_task_idx ON attachments (task_id, created_at);
