export const MIGRATION_026 = {
  version: 26,
  name: '026_trusted_runners',
  sql: `
CREATE TABLE trusted_runners (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  runner_identity_id TEXT NOT NULL UNIQUE REFERENCES runner_identities(id),
  actor_id TEXT REFERENCES actors(id),
  trust_scope_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'rotated', 'revoked')),
  replaced_by_id TEXT REFERENCES trusted_runners(id),
  registered_by TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX trusted_runners_organisation
  ON trusted_runners(organisation_id, status);

CREATE TABLE trusted_runner_events (
  id TEXT PRIMARY KEY,
  trusted_runner_id TEXT NOT NULL REFERENCES trusted_runners(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('registered', 'rotated', 'revoked')),
  actor_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TRIGGER trusted_runner_events_immutable_update
BEFORE UPDATE ON trusted_runner_events
BEGIN
  SELECT RAISE(ABORT, 'Trusted runner events are immutable');
END;

CREATE TRIGGER trusted_runner_events_immutable_delete
BEFORE DELETE ON trusted_runner_events
BEGIN
  SELECT RAISE(ABORT, 'Trusted runner events are immutable');
END;
`,
};
