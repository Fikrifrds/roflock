export const MIGRATION_013 = {
  version: 13,
  name: '013_verification_specifications',
  sql: `
CREATE TABLE verification_specifications (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL UNIQUE,
  contract_hash TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  plan_hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  artifact_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER verification_specifications_immutable_update
BEFORE UPDATE ON verification_specifications
BEGIN
  SELECT RAISE(ABORT, 'verification specifications are immutable');
END;

CREATE TRIGGER verification_specifications_immutable_delete
BEFORE DELETE ON verification_specifications
BEGIN
  SELECT RAISE(ABORT, 'verification specifications are immutable');
END;
`,
} as const;
