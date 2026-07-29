export const MIGRATION_022 = {
  version: 22,
  name: '022_github_status_checks',
  sql: `
CREATE TABLE github_status_checks (
  id TEXT PRIMARY KEY,
  github_repository_mapping_id TEXT NOT NULL REFERENCES github_repositories(id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  commit_sha TEXT NOT NULL,
  check_run_id TEXT,
  passport_id TEXT,
  passport_payload_digest TEXT,
  conclusion TEXT NOT NULL CHECK (conclusion IN ('success', 'failure', 'pending')),
  summary TEXT NOT NULL,
  details_url TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX github_status_checks_commit
  ON github_status_checks(github_repository_mapping_id, commit_sha, created_at DESC);

CREATE TRIGGER github_status_checks_immutable_update
BEFORE UPDATE ON github_status_checks
BEGIN
  SELECT RAISE(ABORT, 'GitHub status checks are immutable');
END;

CREATE TRIGGER github_status_checks_immutable_delete
BEFORE DELETE ON github_status_checks
BEGIN
  SELECT RAISE(ABORT, 'GitHub status checks are immutable');
END;
`,
};
