export const MIGRATION_020 = {
  version: 20,
  name: '020_github_identity',
  sql: `
CREATE TABLE github_installations (
  id TEXT PRIMARY KEY,
  github_installation_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('User', 'Organization')),
  status TEXT NOT NULL CHECK (status IN ('active', 'suspended', 'removed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE github_repositories (
  id TEXT PRIMARY KEY,
  installation_id TEXT NOT NULL REFERENCES github_installations(id),
  github_repository_id TEXT NOT NULL UNIQUE,
  node_id TEXT,
  owner_login TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  project_id TEXT UNIQUE REFERENCES projects(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX github_repositories_installation
  ON github_repositories(installation_id, full_name);

CREATE TABLE github_actors (
  id TEXT PRIMARY KEY,
  github_user_id TEXT NOT NULL UNIQUE,
  node_id TEXT,
  login TEXT NOT NULL,
  roleflock_actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX github_actors_roleflock
  ON github_actors(roleflock_actor_id);
`,
};
