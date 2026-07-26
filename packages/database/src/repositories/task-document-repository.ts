import type { SqliteDb } from '../client.js';

export type DocumentAuthority =
  | 'authoritative_requirement'
  | 'approved_plan'
  | 'reference'
  | 'inspiration_only';

export type DocumentKind =
  | 'prd'
  | 'implementation_plan'
  | 'architecture'
  | 'api_spec'
  | 'schema'
  | 'ticket'
  | 'wireframe'
  | 'screenshot'
  | 'code_sample'
  | 'research'
  | 'other';

export interface TaskDocument {
  id: string;
  taskId: string;
  kind: DocumentKind;
  authority: DocumentAuthority;
  fileName: string;
  mimeType?: string;
  byteSize: number;
  sha256: string;
  storagePath: string;
  extractedText?: string;
  createdAt: string;
}

export class TaskDocumentRepository {
  constructor(private readonly db: SqliteDb) {}

  create(doc: TaskDocument): TaskDocument {
    this.db
      .prepare(
        `INSERT INTO task_documents
          (id, task_id, kind, authority, file_name, mime_type, byte_size, sha256, storage_path, extracted_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        doc.id,
        doc.taskId,
        doc.kind,
        doc.authority,
        doc.fileName,
        doc.mimeType ?? null,
        doc.byteSize,
        doc.sha256,
        doc.storagePath,
        doc.extractedText ?? null,
        doc.createdAt,
      );
    return doc;
  }

  listByTask(taskId: string): TaskDocument[] {
    const rows = this.db
      .prepare(`SELECT * FROM task_documents WHERE task_id = ? ORDER BY created_at ASC`)
      .all(taskId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      taskId: String(row.task_id),
      kind: String(row.kind) as DocumentKind,
      authority: String(row.authority) as DocumentAuthority,
      fileName: String(row.file_name),
      mimeType: row.mime_type ? String(row.mime_type) : undefined,
      byteSize: Number(row.byte_size),
      sha256: String(row.sha256),
      storagePath: String(row.storage_path),
      extractedText: row.extracted_text ? String(row.extracted_text) : undefined,
      createdAt: String(row.created_at),
    }));
  }

  get(id: string): TaskDocument | undefined {
    const row = this.db
      .prepare(`SELECT * FROM task_documents WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      kind: String(row.kind) as DocumentKind,
      authority: String(row.authority) as DocumentAuthority,
      fileName: String(row.file_name),
      mimeType: row.mime_type ? String(row.mime_type) : undefined,
      byteSize: Number(row.byte_size),
      sha256: String(row.sha256),
      storagePath: String(row.storage_path),
      extractedText: row.extracted_text ? String(row.extracted_text) : undefined,
      createdAt: String(row.created_at),
    };
  }
}
