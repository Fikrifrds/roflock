export const MIGRATION_032 = {
  version: 32,
  name: '032_post_merge_outcomes',
  sql: `
CREATE TABLE post_merge_outcomes (
  post_merge_outcome_id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES outcome_observations(observation_id),
  task_id TEXT NOT NULL REFERENCES tasks(id),
  result_commit TEXT NOT NULL,
  outcome_type TEXT NOT NULL CHECK (
    outcome_type IN ('healthy', 'rollback', 'escaped_defect')
  ),
  severity TEXT NOT NULL,
  outcome_digest TEXT NOT NULL UNIQUE,
  outcome_json TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX post_merge_outcomes_observation
  ON post_merge_outcomes(observation_id, detected_at);

CREATE TRIGGER post_merge_outcomes_immutable_update
BEFORE UPDATE ON post_merge_outcomes
BEGIN
  SELECT RAISE(ABORT, 'Post-merge outcomes are immutable');
END;

CREATE TRIGGER post_merge_outcomes_immutable_delete
BEFORE DELETE ON post_merge_outcomes
BEGIN
  SELECT RAISE(ABORT, 'Post-merge outcomes are immutable');
END;
`,
};
