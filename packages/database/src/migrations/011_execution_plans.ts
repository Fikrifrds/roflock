export const MIGRATION_011 = {
  version: 11,
  name: '011_execution_plans',
  sql: `
CREATE TABLE execution_plan_aggregates (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  contract_id TEXT NOT NULL,
  current_version INTEGER NOT NULL,
  current_snapshot_id TEXT NOT NULL,
  current_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE execution_plan_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  hash TEXT NOT NULL,
  status TEXT NOT NULL,
  artifact_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(plan_id, hash)
);

CREATE INDEX execution_plan_snapshots_history_idx
  ON execution_plan_snapshots(plan_id, created_at);

CREATE TRIGGER execution_plan_snapshots_immutable_update
BEFORE UPDATE ON execution_plan_snapshots
BEGIN
  SELECT RAISE(ABORT, 'execution plan snapshots are immutable');
END;

CREATE TRIGGER execution_plan_snapshots_immutable_delete
BEFORE DELETE ON execution_plan_snapshots
BEGIN
  SELECT RAISE(ABORT, 'execution plan snapshots are immutable');
END;

CREATE TABLE plan_deviations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  artifact_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX plan_deviations_task_idx ON plan_deviations(task_id, created_at);
`,
} as const;
