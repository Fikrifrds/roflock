export const MIGRATION_016 = {
  version: 16,
  name: '016_change_passports',
  sql: `
CREATE TABLE change_passports (
  passport_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  result_commit TEXT NOT NULL,
  payload_digest TEXT NOT NULL UNIQUE,
  issuer_identity_id TEXT NOT NULL REFERENCES runner_identities(id),
  verdict TEXT NOT NULL,
  envelope_json TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX change_passports_task_issued
  ON change_passports(task_id, issued_at DESC);

CREATE TABLE passport_revocations (
  passport_id TEXT PRIMARY KEY REFERENCES change_passports(passport_id),
  payload_digest TEXT NOT NULL,
  reason TEXT NOT NULL,
  revoked_by TEXT NOT NULL,
  revoked_at TEXT NOT NULL,
  revocation_json TEXT NOT NULL
);

CREATE TRIGGER change_passports_immutable_update
BEFORE UPDATE ON change_passports
BEGIN
  SELECT RAISE(ABORT, 'change passports are immutable');
END;

CREATE TRIGGER change_passports_immutable_delete
BEFORE DELETE ON change_passports
BEGIN
  SELECT RAISE(ABORT, 'change passports are immutable');
END;

CREATE TRIGGER passport_revocations_immutable_update
BEFORE UPDATE ON passport_revocations
BEGIN
  SELECT RAISE(ABORT, 'passport revocations are immutable');
END;

CREATE TRIGGER passport_revocations_immutable_delete
BEFORE DELETE ON passport_revocations
BEGIN
  SELECT RAISE(ABORT, 'passport revocations are immutable');
END;
`,
} as const;
