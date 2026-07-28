export const MIGRATION_008 = {
  version: 8,
  name: '008_change_contracts',
  sql: `
CREATE TABLE IF NOT EXISTS change_contracts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  current_contract_version INTEGER NOT NULL,
  current_version_id TEXT NOT NULL,
  current_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (current_contract_version > 0),
  CHECK (revision > 0)
);

CREATE TABLE IF NOT EXISTS change_contract_versions (
  version_id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  parent_version_id TEXT,
  status TEXT NOT NULL,
  hash TEXT NOT NULL,
  contract_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (contract_id) REFERENCES change_contracts(id),
  UNIQUE (contract_id, version),
  UNIQUE (contract_id, hash)
);

CREATE INDEX IF NOT EXISTS idx_change_contract_versions_contract
  ON change_contract_versions(contract_id, version);
CREATE INDEX IF NOT EXISTS idx_change_contracts_project
  ON change_contracts(project_id, updated_at);

CREATE TRIGGER IF NOT EXISTS change_contract_versions_terminal_update_guard
BEFORE UPDATE ON change_contract_versions
WHEN OLD.status IN ('authorised', 'superseded', 'withdrawn')
BEGIN
  SELECT RAISE(ABORT, 'terminal change contract version is immutable');
END;

CREATE TRIGGER IF NOT EXISTS change_contract_versions_terminal_delete_guard
BEFORE DELETE ON change_contract_versions
WHEN OLD.status IN ('authorised', 'superseded', 'withdrawn')
BEGIN
  SELECT RAISE(ABORT, 'terminal change contract version is immutable');
END;
`,
};
