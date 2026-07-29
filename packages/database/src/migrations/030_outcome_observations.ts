export const MIGRATION_030 = {
  version: 30,
  name: '030_outcome_observations',
  sql: `
CREATE TABLE outcome_observations (
  observation_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  task_type TEXT NOT NULL,
  risk TEXT NOT NULL,
  repository_size_bucket TEXT NOT NULL,
  role_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_family TEXT,
  profile_version TEXT NOT NULL,
  routing_policy_version TEXT NOT NULL,
  status TEXT NOT NULL,
  excluded INTEGER NOT NULL DEFAULT 0,
  observation_digest TEXT NOT NULL UNIQUE,
  observation_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX outcome_observations_cohort
  ON outcome_observations(
    task_type, risk, repository_size_bucket, role_id, provider_id, model_id, observed_at
  );

CREATE TRIGGER outcome_observations_immutable_update
BEFORE UPDATE ON outcome_observations
BEGIN
  SELECT RAISE(ABORT, 'Outcome observations are immutable');
END;

CREATE TRIGGER outcome_observations_immutable_delete
BEFORE DELETE ON outcome_observations
BEGIN
  SELECT RAISE(ABORT, 'Outcome observations are immutable');
END;
`,
};
