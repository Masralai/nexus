/**
 * SQLite migrations. Statements are idempotent and applied in order using
 * PRAGMA user_version. Drizzle schema definitions live in ./schema.ts.
 */
export const MIGRATIONS: string[] = [
  `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  worktree TEXT NOT NULL,
  vcs TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  parent_id TEXT,
  fork_boundary TEXT,
  cwd TEXT NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_created_idx ON sessions (created_at);

CREATE TABLE IF NOT EXISTS session_parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  part_type TEXT NOT NULL,
  data TEXT NOT NULL,
  message_json TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS session_parts_seq_idx ON session_parts (session_id, seq);
CREATE INDEX IF NOT EXISTS session_parts_message_idx ON session_parts (session_id, message_id);

CREATE TABLE IF NOT EXISTS session_pending (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_inbox (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_permissions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  tool TEXT NOT NULL,
  pattern TEXT,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  provider TEXT PRIMARY KEY,
  secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_sequence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS event_sequence_seq_idx ON event_sequence (session_id, seq);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instruction_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instruction_blobs (
  hash TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instruction_state (
  scope TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worktrees (
  directory TEXT PRIMARY KEY,
  strategy TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  path TEXT,
  created_at TEXT NOT NULL
);
`,
  `
ALTER TABLE session_parts ADD COLUMN role TEXT;
ALTER TABLE sessions ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN summary TEXT;
`,
  `
CREATE TABLE IF NOT EXISTS permission_audit (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  tool TEXT NOT NULL,
  input TEXT NOT NULL,
  action TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS permission_audit_session_idx ON permission_audit (session_id);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  command TEXT NOT NULL,
  status TEXT NOT NULL,
  output TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_session_idx ON jobs (session_id);
`,
]
