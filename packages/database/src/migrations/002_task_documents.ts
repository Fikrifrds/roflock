export const MIGRATION_002 = {
  version: 2,
  name: 'task_documents',
  sql: `
CREATE TABLE IF NOT EXISTS task_documents (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  authority TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  extracted_text TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_documents_task ON task_documents(task_id);
`,
};
