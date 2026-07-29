export const MIGRATION_024 = {
  version: 24,
  name: '024_github_comment_feedback',
  sql: `
CREATE TABLE github_comment_feedback (
  id TEXT PRIMARY KEY,
  github_repository_mapping_id TEXT NOT NULL REFERENCES github_repositories(id),
  github_comment_id TEXT NOT NULL UNIQUE,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('issue', 'pull_request')),
  subject_number INTEGER NOT NULL,
  github_actor_mapping_id TEXT REFERENCES github_actors(id),
  body_digest TEXT NOT NULL,
  feedback_id TEXT NOT NULL UNIQUE REFERENCES feedback_items(id),
  received_at TEXT NOT NULL
);

CREATE INDEX github_comment_feedback_subject
  ON github_comment_feedback(
    github_repository_mapping_id, subject_type, subject_number, received_at
  );

CREATE TRIGGER github_comment_feedback_immutable_update
BEFORE UPDATE ON github_comment_feedback
BEGIN
  SELECT RAISE(ABORT, 'GitHub comment feedback receipts are immutable');
END;

CREATE TRIGGER github_comment_feedback_immutable_delete
BEFORE DELETE ON github_comment_feedback
BEGIN
  SELECT RAISE(ABORT, 'GitHub comment feedback receipts are immutable');
END;
`,
};
