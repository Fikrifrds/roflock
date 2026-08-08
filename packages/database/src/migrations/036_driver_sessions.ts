export const MIGRATION_036 = {
  version: 36,
  name: '036_driver_sessions',
  sql: `
ALTER TABLE invocations ADD COLUMN driver_id TEXT;
ALTER TABLE invocations ADD COLUMN driver_session_id TEXT;
ALTER TABLE invocations ADD COLUMN resumed_from_invocation_id TEXT;
ALTER TABLE invocations ADD COLUMN cancellation_capability TEXT;
ALTER TABLE invocations ADD COLUMN interruption_json TEXT;

CREATE INDEX IF NOT EXISTS invocations_driver_session_idx
  ON invocations(driver_id, driver_session_id)
  WHERE driver_session_id IS NOT NULL;
`,
};
