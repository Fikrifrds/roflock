export const MIGRATION_033 = {
  version: 33,
  name: '033_adaptive_routing_controls',
  sql: `
CREATE TABLE adaptive_routing_controls (
  id TEXT PRIMARY KEY,
  organisation_id TEXT REFERENCES organisations(id),
  project_id TEXT REFERENCES projects(id),
  target_type TEXT NOT NULL CHECK (
    target_type IN ('observation', 'cohort', 'model', 'routing')
  ),
  target_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN ('exclude', 'include', 'freeze', 'unfreeze', 'override', 'clear_override')
  ),
  value_json TEXT,
  reason TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX adaptive_routing_controls_target
  ON adaptive_routing_controls(target_type, target_id, created_at DESC);

CREATE TRIGGER adaptive_routing_controls_immutable_update
BEFORE UPDATE ON adaptive_routing_controls
BEGIN
  SELECT RAISE(ABORT, 'Adaptive routing controls are immutable');
END;

CREATE TRIGGER adaptive_routing_controls_immutable_delete
BEFORE DELETE ON adaptive_routing_controls
BEGIN
  SELECT RAISE(ABORT, 'Adaptive routing controls are immutable');
END;
`,
};
