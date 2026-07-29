export const MIGRATION_015 = {
  version: 15,
  name: '015_runner_identities',
  sql: `
CREATE TABLE runner_identities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  key_id TEXT NOT NULL UNIQUE,
  key_reference TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  issuer TEXT,
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX runner_identities_one_active_local
  ON runner_identities(kind)
  WHERE kind = 'local_installation' AND status = 'active';
`,
} as const;
