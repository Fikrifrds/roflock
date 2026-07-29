export const MIGRATION_027 = {
  version: 27,
  name: '027_shared_policies_credentials',
  sql: `
CREATE TABLE shared_policy_bundles (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  bundle_digest TEXT NOT NULL,
  bundle_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'revoked')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(organisation_id, name, version)
);

CREATE TABLE shared_policy_assignments (
  id TEXT PRIMARY KEY,
  policy_bundle_id TEXT NOT NULL REFERENCES shared_policy_bundles(id),
  project_id TEXT REFERENCES projects(id),
  role_id TEXT,
  trusted_runner_id TEXT REFERENCES trusted_runners(id),
  priority INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE scoped_credential_grants (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  grantee_actor_id TEXT REFERENCES actors(id),
  trusted_runner_id TEXT REFERENCES trusted_runners(id),
  secret_reference TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  project_ids_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'revoked', 'expired')),
  granted_by TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  CHECK (grantee_actor_id IS NOT NULL OR trusted_runner_id IS NOT NULL)
);

CREATE INDEX scoped_credential_grants_active
  ON scoped_credential_grants(organisation_id, status, expires_at);

CREATE TRIGGER shared_policy_bundles_immutable_update
BEFORE UPDATE ON shared_policy_bundles
BEGIN
  SELECT RAISE(ABORT, 'Shared policy bundles are immutable');
END;

CREATE TRIGGER shared_policy_bundles_immutable_delete
BEFORE DELETE ON shared_policy_bundles
BEGIN
  SELECT RAISE(ABORT, 'Shared policy bundles are immutable');
END;
`,
};
