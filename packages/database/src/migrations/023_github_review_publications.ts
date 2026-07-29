export const MIGRATION_023 = {
  version: 23,
  name: '023_github_review_publications',
  sql: `
CREATE TABLE github_review_publications (
  id TEXT PRIMARY KEY,
  github_repository_mapping_id TEXT NOT NULL REFERENCES github_repositories(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  pull_request_number INTEGER NOT NULL,
  commit_sha TEXT NOT NULL,
  passport_id TEXT NOT NULL,
  passport_payload_digest TEXT NOT NULL,
  packet_body_digest TEXT NOT NULL,
  github_comment_id TEXT,
  github_comment_url TEXT,
  published_by TEXT NOT NULL,
  published_at TEXT NOT NULL
);

CREATE INDEX github_review_publications_pr
  ON github_review_publications(
    github_repository_mapping_id, pull_request_number, published_at DESC
  );

CREATE TRIGGER github_review_publications_immutable_update
BEFORE UPDATE ON github_review_publications
BEGIN
  SELECT RAISE(ABORT, 'GitHub review publications are immutable');
END;

CREATE TRIGGER github_review_publications_immutable_delete
BEFORE DELETE ON github_review_publications
BEGIN
  SELECT RAISE(ABORT, 'GitHub review publications are immutable');
END;
`,
};
