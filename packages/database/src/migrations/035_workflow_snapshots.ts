export const MIGRATION_035 = {
  version: 35,
  name: '035_workflow_snapshots',
  sql: `
-- The version label alone is not an immutable workflow identity: a compiled
-- .roflock template can change while retaining the compatibility label
-- "bug_fix@3". Keep the exact executable graph and its authored inputs beside
-- the task so restart and later inspection never consult mutable registry state.
CREATE TABLE workflow_snapshots (
  task_id TEXT PRIMARY KEY,
  graph_version_id TEXT NOT NULL,
  semantic_hash TEXT,
  graph_snapshot_hash TEXT NOT NULL,
  source TEXT,
  graph_ir_json TEXT,
  workflow_graph_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX workflow_snapshots_graph_identity_idx
  ON workflow_snapshots(task_id, graph_snapshot_hash);
`,
};
