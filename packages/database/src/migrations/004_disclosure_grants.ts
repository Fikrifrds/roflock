export const MIGRATION_004 = {
  version: 4,
  name: 'disclosure_grants',
  sql: `
CREATE TABLE IF NOT EXISTS disclosure_grants (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  provider_connection_id TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_disclosure_grants_project ON disclosure_grants(project_id);
CREATE INDEX IF NOT EXISTS idx_disclosure_grants_provider ON disclosure_grants(provider_connection_id);
`,
};
