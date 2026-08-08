export const MIGRATION_034 = {
  version: 34,
  name: '034_invocation_identity',
  sql: `
-- A paid provider turn needs an identity that survives the process that made
-- it. Without one, a resumed run cannot tell "this work was already done and
-- billed" from "this work has not started", and the safe-looking choice —
-- run it again — is the one that costs money twice.
ALTER TABLE invocations ADD COLUMN idempotency_key TEXT;

-- Partial, so the rows that predate this column do not collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS invocations_idempotency_idx
  ON invocations(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
`,
};
