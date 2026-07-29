export const MIGRATION_029 = {
  version: 29,
  name: '029_metadata_sync',
  sql: `
CREATE TABLE metadata_sync_batches (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  installation_id TEXT NOT NULL,
  cursor TEXT NOT NULL,
  envelope_hash TEXT NOT NULL UNIQUE,
  envelope_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'synced', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  synced_at TEXT
);

CREATE TABLE metadata_sync_checkpoints (
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  installation_id TEXT NOT NULL,
  remote_cursor TEXT NOT NULL,
  envelope_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(organisation_id, installation_id)
);
`,
};
