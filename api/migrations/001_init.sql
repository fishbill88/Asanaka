-- Asanaka schema, version 1. Positions are fractional-index keys compared byte by byte (COLLATE "C"),
-- so moving a card rewrites only that card's row.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  avatar_hue    integer NOT NULL DEFAULT 0,
  disabled      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_username_key ON users (lower(username));

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE login_failures (
  ip           text NOT NULL,
  username     text NOT NULL,
  failures     integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ip, username)
);

CREATE TABLE projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  color           text NOT NULL DEFAULT '#b0298f',
  position        text COLLATE "C" NOT NULL,
  done_section_id uuid,
  archived_at     timestamptz,
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sections (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name       text NOT NULL,
  position   text COLLATE "C" NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sections_project_idx ON sections (project_id, position);
ALTER TABLE projects ADD CONSTRAINT projects_done_section_fk FOREIGN KEY (done_section_id) REFERENCES sections (id) ON DELETE SET NULL;

CREATE TABLE tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  section_id          uuid REFERENCES sections (id) ON DELETE CASCADE,
  parent_id           uuid REFERENCES tasks (id) ON DELETE CASCADE,
  title               text NOT NULL,
  notes               text NOT NULL DEFAULT '',
  assignee_id         uuid REFERENCES users (id) ON DELETE SET NULL,
  due_on              date,
  priority            text CHECK (priority IN ('low', 'medium', 'high')),
  status              text CHECK (status IN ('on_track', 'at_risk', 'off_track')),
  completed_at        timestamptz,
  completed_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  previous_section_id uuid REFERENCES sections (id) ON DELETE SET NULL,
  position            text COLLATE "C" NOT NULL,
  created_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE INDEX tasks_board_idx ON tasks (section_id, position) WHERE deleted_at IS NULL AND parent_id IS NULL;
CREATE INDEX tasks_parent_idx ON tasks (parent_id, position) WHERE deleted_at IS NULL;

CREATE TABLE comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  author_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz
);
CREATE INDEX comments_task_idx ON comments (task_id, created_at);

CREATE TABLE task_likes (
  task_id uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);

CREATE TABLE activity (
  id         bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  task_id    uuid REFERENCES tasks (id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  kind       text NOT NULL,
  data       jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_task_idx ON activity (task_id, created_at DESC);

-- The first project, so a fresh install opens on a board. Separate statements: a statement cannot
-- see rows that another part of the same statement inserted.
INSERT INTO projects (name, position) VALUES ('Asanaka launch', 'a0');
INSERT INTO sections (project_id, name, position)
SELECT p.id, v.name, v.pos FROM projects p, (VALUES ('To do', 'a0'), ('Doing', 'a1'), ('Review', 'a2'), ('Done', 'a3')) AS v (name, pos)
WHERE p.name = 'Asanaka launch';
UPDATE projects p SET done_section_id = s.id FROM sections s WHERE s.project_id = p.id AND s.name = 'Done' AND p.name = 'Asanaka launch';
