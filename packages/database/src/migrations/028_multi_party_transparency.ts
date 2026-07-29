export const MIGRATION_028 = {
  version: 28,
  name: '028_multi_party_transparency',
  sql: `
CREATE TABLE multi_party_approval_policies (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  quorum INTEGER NOT NULL CHECK (quorum > 0),
  required_roles_json TEXT NOT NULL,
  veto_roles_json TEXT NOT NULL,
  policy_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'revoked')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(organisation_id, name, version)
);

CREATE TABLE multi_party_approval_decisions (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES multi_party_approval_policies(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  artifact_digest TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES actors(id),
  actor_role TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  signature_digest TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  UNIQUE(policy_id, artifact_digest, actor_id)
);

CREATE TABLE transparency_log_entries (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  sequence INTEGER NOT NULL,
  previous_hash TEXT,
  entry_hash TEXT NOT NULL UNIQUE,
  entry_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE(organisation_id, sequence)
);

CREATE TRIGGER transparency_log_entries_immutable_update
BEFORE UPDATE ON transparency_log_entries
BEGIN
  SELECT RAISE(ABORT, 'Transparency log entries are immutable');
END;

CREATE TRIGGER transparency_log_entries_immutable_delete
BEFORE DELETE ON transparency_log_entries
BEGIN
  SELECT RAISE(ABORT, 'Transparency log entries are immutable');
END;
`,
};
