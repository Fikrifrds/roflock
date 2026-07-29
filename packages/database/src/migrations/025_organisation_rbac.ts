export const MIGRATION_025 = {
  version: 25,
  name: '025_organisation_rbac',
  sql: `
CREATE TABLE organisations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE actors (
  id TEXT PRIMARY KEY,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'service', 'runner')),
  display_name TEXT NOT NULL,
  primary_email TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE organisation_memberships (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  actor_id TEXT NOT NULL REFERENCES actors(id),
  role TEXT NOT NULL CHECK (
    role IN ('owner', 'admin', 'planner', 'executor', 'verifier', 'viewer')
  ),
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organisation_id, actor_id)
);

CREATE TABLE organisation_projects (
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY(organisation_id, project_id)
);

CREATE INDEX organisation_memberships_actor
  ON organisation_memberships(actor_id, status);
`,
};
