export const MIGRATION_012 = {
  version: 12,
  name: '012_concurrency_policy',
  sql: `
CREATE TABLE concurrency_policies (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'project')),
  scope_id TEXT NOT NULL,
  max_active_tasks INTEGER NOT NULL CHECK (max_active_tasks > 0),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_id)
);

INSERT INTO concurrency_policies (
  scope_type, scope_id, max_active_tasks, revision, created_at, updated_at
) VALUES (
  'global', '*', 4, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

CREATE TABLE concurrency_slots (
  task_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  released_at TEXT
);

CREATE INDEX concurrency_slots_active_project_idx
  ON concurrency_slots(project_id, released_at);
`,
} as const;
