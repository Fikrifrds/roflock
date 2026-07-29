export const MIGRATION_019 = {
  version: 19,
  name: '019_external_agent_events',
  sql: `
CREATE TABLE external_agent_sessions (
  id TEXT PRIMARY KEY,
  agent_family TEXT NOT NULL,
  adapter_id TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  native_session_id TEXT NOT NULL,
  installation_id TEXT,
  task_id TEXT NOT NULL,
  contract_hash TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  worktree_id TEXT NOT NULL,
  worktree_path_hash TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  base_commit TEXT NOT NULL,
  binding_json TEXT NOT NULL,
  last_sequence INTEGER NOT NULL,
  last_event_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX external_agent_sessions_source
  ON external_agent_sessions(
    agent_family, adapter_id, native_session_id, COALESCE(installation_id, '')
  );

CREATE INDEX external_agent_sessions_task
  ON external_agent_sessions(task_id, updated_at DESC);

CREATE TABLE external_agent_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES external_agent_sessions(id),
  source_event_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_hash TEXT NOT NULL UNIQUE,
  payload_type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, source_event_id),
  UNIQUE(session_id, sequence)
);

CREATE INDEX external_agent_events_task_order
  ON external_agent_events(session_id, sequence ASC);

CREATE TRIGGER external_agent_events_immutable_update
BEFORE UPDATE ON external_agent_events
BEGIN
  SELECT RAISE(ABORT, 'external agent events are immutable');
END;

CREATE TRIGGER external_agent_events_immutable_delete
BEFORE DELETE ON external_agent_events
BEGIN
  SELECT RAISE(ABORT, 'external agent events are immutable');
END;
`,
} as const;
