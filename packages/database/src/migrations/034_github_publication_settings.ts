export const MIGRATION_034 = {
  version: 34,
  name: '034_github_publication_settings',
  sql: `
-- Publishing to GitHub is the first outbound call that carries a user's
-- repository data, so it is stored as an explicit per-repository opt-in rather
-- than inferred from the presence of a mapping or a credential.
CREATE TABLE github_publication_settings (
  github_repository_mapping_id TEXT PRIMARY KEY REFERENCES github_repositories(id),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  -- Reference into the secret store. The token itself is never in SQLite.
  token_secret_id TEXT,
  -- The status name a branch protection rule requires. Changing it silently
  -- would leave the old required check permanently unsatisfied, so it is stored
  -- per repository rather than assumed.
  status_context TEXT NOT NULL,
  publish_review_comments INTEGER NOT NULL CHECK (publish_review_comments IN (0, 1)),
  updated_at TEXT NOT NULL
);
`,
};
