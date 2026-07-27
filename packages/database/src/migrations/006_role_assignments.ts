export const MIGRATION_006 = {
  version: 6,
  name: '006_role_assignments',
  sql: `
-- An ordered list of provider+model candidates per role. Position 0 is the
-- preference; later rows are what the router falls back to when a candidate is
-- unhealthy, rejects the model, or runs out of quota.
CREATE TABLE IF NOT EXISTS role_assignments (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  position INTEGER NOT NULL,
  provider_connection_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  effort TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS role_assignments_order
  ON role_assignments (role, position);

-- A candidate that reported an exhausted quota is parked here until the window
-- is expected to reset. Persisted rather than in-memory so a daemon restart
-- does not immediately hammer a provider that already said no.
CREATE TABLE IF NOT EXISTS provider_cooldowns (
  id TEXT PRIMARY KEY,
  provider_connection_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  detail TEXT,
  started_at TEXT NOT NULL,
  until TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_cooldowns_target
  ON provider_cooldowns (provider_connection_id, model_id);
`,
};
