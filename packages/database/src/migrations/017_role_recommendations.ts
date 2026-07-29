export const MIGRATION_017 = {
  version: 17,
  name: '017_role_recommendations',
  sql: `
CREATE TABLE model_capability_profiles (
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  bundle_version TEXT NOT NULL,
  profile_digest TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (provider_id, model_id, profile_version)
);

CREATE TABLE role_recommendations (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  recommendation_version TEXT NOT NULL,
  risk TEXT NOT NULL,
  profile_bundle_version TEXT NOT NULL,
  profile_bundle_digest TEXT NOT NULL,
  scoring_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  complete INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  generated_at TEXT NOT NULL
);

CREATE INDEX role_recommendations_task_generated
  ON role_recommendations(task_id, generated_at DESC, id DESC);

CREATE TABLE role_recommendation_candidates (
  recommendation_id TEXT NOT NULL REFERENCES role_recommendations(id),
  role TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  rank INTEGER,
  selected INTEGER NOT NULL,
  fallback INTEGER NOT NULL,
  eligible INTEGER NOT NULL,
  candidate_json TEXT NOT NULL,
  PRIMARY KEY (recommendation_id, role, provider_id, model_id)
);

CREATE INDEX role_recommendation_candidates_rank
  ON role_recommendation_candidates(recommendation_id, role, eligible DESC, rank ASC);

CREATE TABLE role_recommendation_actions (
  id TEXT PRIMARY KEY,
  recommendation_id TEXT NOT NULL REFERENCES role_recommendations(id),
  revision INTEGER NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  role TEXT,
  provider_id TEXT,
  model_id TEXT,
  reason TEXT,
  roster_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (recommendation_id, revision),
  UNIQUE (recommendation_id, idempotency_key)
);

CREATE TRIGGER model_capability_profiles_immutable_update
BEFORE UPDATE ON model_capability_profiles
BEGIN
  SELECT RAISE(ABORT, 'model capability profiles are immutable');
END;

CREATE TRIGGER model_capability_profiles_immutable_delete
BEFORE DELETE ON model_capability_profiles
BEGIN
  SELECT RAISE(ABORT, 'model capability profiles are immutable');
END;

CREATE TRIGGER role_recommendations_immutable_update
BEFORE UPDATE ON role_recommendations
BEGIN
  SELECT RAISE(ABORT, 'role recommendations are immutable');
END;

CREATE TRIGGER role_recommendations_immutable_delete
BEFORE DELETE ON role_recommendations
BEGIN
  SELECT RAISE(ABORT, 'role recommendations are immutable');
END;

CREATE TRIGGER role_recommendation_candidates_immutable_update
BEFORE UPDATE ON role_recommendation_candidates
BEGIN
  SELECT RAISE(ABORT, 'role recommendation candidates are immutable');
END;

CREATE TRIGGER role_recommendation_candidates_immutable_delete
BEFORE DELETE ON role_recommendation_candidates
BEGIN
  SELECT RAISE(ABORT, 'role recommendation candidates are immutable');
END;

CREATE TRIGGER role_recommendation_actions_immutable_update
BEFORE UPDATE ON role_recommendation_actions
BEGIN
  SELECT RAISE(ABORT, 'role recommendation actions are immutable');
END;

CREATE TRIGGER role_recommendation_actions_immutable_delete
BEFORE DELETE ON role_recommendation_actions
BEGIN
  SELECT RAISE(ABORT, 'role recommendation actions are immutable');
END;
`,
} as const;
