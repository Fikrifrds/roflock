export const MIGRATION_005 = {
  version: 5,
  name: '005_task_verification_command',
  sql: `
ALTER TABLE tasks ADD COLUMN verification_command TEXT;
`,
};
