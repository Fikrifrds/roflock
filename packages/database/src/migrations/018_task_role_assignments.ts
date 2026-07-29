export const MIGRATION_018 = {
  version: 18,
  name: '018_task_role_assignments',
  sql: `
CREATE TABLE task_role_assignments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  role TEXT NOT NULL,
  position INTEGER NOT NULL,
  provider_connection_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  effort TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  recommendation_id TEXT NOT NULL,
  recommendation_action_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX task_role_assignments_order
  ON task_role_assignments(task_id, role, position);

CREATE INDEX task_role_assignments_provenance
  ON task_role_assignments(recommendation_id, recommendation_action_id);
`,
} as const;
