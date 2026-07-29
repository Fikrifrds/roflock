export const MIGRATION_021 = {
  version: 21,
  name: '021_github_authority_links',
  sql: `
CREATE TABLE github_authority_links (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  contract_id TEXT NOT NULL,
  contract_hash TEXT NOT NULL,
  github_repository_mapping_id TEXT NOT NULL REFERENCES github_repositories(id),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('issue', 'pull_request')),
  subject_number INTEGER NOT NULL CHECK (subject_number > 0),
  subject_node_id TEXT,
  subject_url TEXT NOT NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('authority_source', 'delivery_target')),
  linked_by TEXT NOT NULL,
  linked_at TEXT NOT NULL,
  UNIQUE(task_id, contract_hash, github_repository_mapping_id, subject_type, subject_number, link_type)
);

CREATE INDEX github_authority_links_task
  ON github_authority_links(task_id, linked_at);

CREATE TRIGGER github_authority_links_immutable_update
BEFORE UPDATE ON github_authority_links
BEGIN
  SELECT RAISE(ABORT, 'GitHub authority links are immutable');
END;

CREATE TRIGGER github_authority_links_immutable_delete
BEFORE DELETE ON github_authority_links
BEGIN
  SELECT RAISE(ABORT, 'GitHub authority links are immutable');
END;
`,
};
