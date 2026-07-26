export const MIGRATION_001 = {
  version: 1,
  name: '001_initial',
  sql: `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data_dir TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  repository_path TEXT NOT NULL,
  resolved_path TEXT NOT NULL,
  base_branch TEXT NOT NULL DEFAULT 'main',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repositories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  path TEXT NOT NULL,
  resolved_path TEXT NOT NULL,
  head_commit TEXT,
  is_dirty INTEGER NOT NULL DEFAULT 0,
  validated_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  risk TEXT NOT NULL,
  state TEXT NOT NULL,
  workflow_graph_version_id TEXT NOT NULL,
  budget_policy_id TEXT NOT NULL,
  expected_behaviour TEXT,
  actual_behaviour TEXT,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  max_actual_cost_usd REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_graphs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_versions (
  id TEXT PRIMARY KEY,
  graph_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(graph_id, version)
);

CREATE TABLE IF NOT EXISTS graph_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  graph_version_id TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_nodes (
  id TEXT PRIMARY KEY,
  graph_version_id TEXT NOT NULL,
  node_key TEXT NOT NULL,
  role_id TEXT,
  node_type TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(graph_version_id, node_key)
);

CREATE TABLE IF NOT EXISTS workflow_edges (
  id TEXT PRIMARY KEY,
  graph_version_id TEXT NOT NULL,
  from_node_key TEXT NOT NULL,
  to_node_key TEXT NOT NULL,
  condition_json TEXT
);

CREATE TABLE IF NOT EXISTS node_runs (
  id TEXT PRIMARY KEY,
  graph_run_id TEXT NOT NULL,
  node_key TEXT NOT NULL,
  state TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  started_at TEXT,
  completed_at TEXT,
  outcome TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS loop_attempts (
  id TEXT PRIMARY KEY,
  node_run_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(aggregate_id, sequence)
);

CREATE UNIQUE INDEX IF NOT EXISTS events_idempotency_idx
  ON events(aggregate_id, json_extract(metadata_json, '$.idempotencyKey'))
  WHERE json_extract(metadata_json, '$.idempotencyKey') IS NOT NULL;

CREATE TABLE IF NOT EXISTS state_snapshots (
  aggregate_id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  last_sequence INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  purpose TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  connection_type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_connection_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(provider_connection_id, model_id)
);

CREATE TABLE IF NOT EXISTS role_model_mappings (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL,
  provider_connection_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  effort TEXT,
  permission_profile_id TEXT,
  UNIQUE(role_id)
);

CREATE TABLE IF NOT EXISTS runtime_leases (
  id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT,
  released_at TEXT,
  UNIQUE(resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS process_handles (
  id TEXT PRIMARY KEY,
  node_run_id TEXT,
  invocation_id TEXT,
  pid INTEGER NOT NULL,
  pgid INTEGER,
  command_preview TEXT,
  started_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL,
  status TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS active_executions (
  node_run_id TEXT PRIMARY KEY,
  graph_run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  projection_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS control_commands (
  id TEXT PRIMARY KEY,
  node_run_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  command_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  acknowledged_at TEXT,
  completed_at TEXT,
  error TEXT,
  UNIQUE(node_run_id, command_type, command_version)
);

CREATE TABLE IF NOT EXISTS confirmation_requests (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  graph_run_id TEXT NOT NULL,
  node_run_id TEXT NOT NULL,
  request_type TEXT NOT NULL,
  rationale TEXT NOT NULL,
  exact_action_json TEXT NOT NULL,
  affected_paths_json TEXT,
  command_preview TEXT,
  destination TEXT,
  estimated_additional_cost REAL,
  risk_class TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decision_note TEXT
);

CREATE TABLE IF NOT EXISTS approval_groups (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  project_id TEXT NOT NULL,
  pending_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  confirmation_request_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS approval_grants (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  fingerprint TEXT,
  request_types_json TEXT,
  allowed_path_patterns_json TEXT,
  allowed_command_templates_json TEXT,
  allowed_destinations_json TEXT,
  maximum_risk TEXT NOT NULL,
  maximum_additional_cost REAL,
  maximum_applications INTEGER,
  applications_used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worktrees (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  path TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  writer_lease_id TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS invocations (
  id TEXT PRIMARY KEY,
  node_run_id TEXT NOT NULL,
  provider_connection_id TEXT NOT NULL,
  configured_model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  outcome TEXT,
  error_json TEXT,
  disclosure_manifest_id TEXT
);

CREATE TABLE IF NOT EXISTS usage_ledger_entries (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  invocation_id TEXT,
  provider_connection_id TEXT,
  model_id TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  actual_cost_usd REAL,
  shadow_cost_usd REAL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quota_snapshots (
  id TEXT PRIMARY KEY,
  provider_connection_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  confidence TEXT NOT NULL,
  captured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_cards (
  id TEXT PRIMARY KEY,
  provider_connection_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  input_per_mtok_usd REAL,
  output_per_mtok_usd REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  effective_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artefacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT,
  content_ref TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  node_run_id TEXT,
  command TEXT NOT NULL,
  exit_code INTEGER,
  stdout_ref TEXT,
  stderr_ref TEXT,
  passed INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_findings (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  node_run_id TEXT,
  severity TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_disclosure_manifests (
  id TEXT PRIMARY KEY,
  invocation_id TEXT NOT NULL,
  provider_connection_id TEXT NOT NULL,
  selected_context_json TEXT NOT NULL,
  exclusions_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`,
};
