export const MIGRATION_010 = {
  version: 10,
  name: '010_feedback_items',
  sql: `
CREATE TABLE feedback_items (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  source_actor_id TEXT NOT NULL,
  text TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (
    classification IN (
      'requirement_change',
      'implementation_preference',
      'implementation_defect',
      'plan_gap',
      'verification_gap',
      'policy_exception',
      'interactive_cosmetic_change',
      'unknown'
    )
  ),
  target_contract_hash TEXT,
  target_plan_hash TEXT,
  target_commit TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('received', 'classified', 'routed', 'resolved', 'rejected')
  ),
  routed_role TEXT NOT NULL CHECK (routed_role IN ('planner', 'contract_authority')),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(task_id, idempotency_key)
);

CREATE INDEX feedback_items_task_created_idx
  ON feedback_items(task_id, created_at);
`,
} as const;
