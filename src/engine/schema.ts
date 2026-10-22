import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core"

/**
 * Durable schema for M1.
 *
 * Tables beyond sessions/session_parts exist now so later milestones can add
 * behaviour without rewriting the migration chain.
 */

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  worktree: text("worktree").notNull(),
  vcs: text("vcs"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id"),
    parentId: text("parent_id"),
    forkBoundary: text("fork_boundary"),
    cwd: text("cwd").notNull(),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    title: text("title"),
    status: text("status").notNull().default("running"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    cost: integer("cost").notNull().default(0),
    summary: text("summary"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("sessions_created_idx").on(table.createdAt)],
)

export const sessionParts = sqliteTable(
  "session_parts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    messageId: text("message_id").notNull(),
    seq: integer("seq").notNull(),
    partType: text("part_type").notNull(),
    role: text("role"),
    data: text("data").notNull(),
    /** Provider-ready projection stored once per message for exact replay. */
    messageJson: text("message_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("session_parts_seq_idx").on(table.sessionId, table.seq),
    index("session_parts_message_idx").on(table.sessionId, table.messageId),
  ],
)

export const sessionPending = sqliteTable("session_pending", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  kind: text("kind").notNull(),
  data: text("data").notNull(),
  createdAt: text("created_at").notNull(),
})

export const sessionInbox = sqliteTable("session_inbox", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  data: text("data").notNull(),
  createdAt: text("created_at").notNull(),
})

export const savedPermissions = sqliteTable("saved_permissions", {
  id: text("id").primaryKey(),
  projectId: text("project_id"),
  tool: text("tool").notNull(),
  pattern: text("pattern"),
  action: text("action").notNull(),
  createdAt: text("created_at").notNull(),
})

export const credentials = sqliteTable("credentials", {
  provider: text("provider").primaryKey(),
  secret: text("secret").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const eventSequence = sqliteTable(
  "event_sequence",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    seq: integer("seq").notNull(),
    event: text("event").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("event_sequence_seq_idx").on(table.sessionId, table.seq)],
)

export const kv = sqliteTable("kv", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const instructionEntries = sqliteTable("instruction_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scope: text("scope").notNull(),
  path: text("path").notNull(),
  hash: text("hash").notNull(),
  createdAt: text("created_at").notNull(),
})

export const instructionBlobs = sqliteTable("instruction_blobs", {
  hash: text("hash").primaryKey(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
})

export const instructionState = sqliteTable("instruction_state", {
  scope: text("scope").primaryKey(),
  state: text("state").notNull(),
  updatedAt: text("updated_at").notNull(),
})

export const worktrees = sqliteTable("worktrees", {
  directory: text("directory").primaryKey(),
  strategy: text("strategy"),
  createdAt: text("created_at").notNull(),
})

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  sessionId: text("session_id"),
  kind: text("kind").notNull(),
  data: text("data").notNull(),
  createdAt: text("created_at").notNull(),
})

export const blobs = sqliteTable("blobs", {
  hash: text("hash").primaryKey(),
  bytes: integer("bytes").notNull(),
  path: text("path"),
  createdAt: text("created_at").notNull(),
})
