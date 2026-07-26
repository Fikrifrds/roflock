import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  TaskDocumentRepository,
  type DocumentAuthority,
  type DocumentKind,
  type SqliteDb,
  type TaskDocument,
} from '@roleflock/database';

const AUTHORITIES: DocumentAuthority[] = [
  'authoritative_requirement',
  'approved_plan',
  'reference',
  'inspiration_only',
];

const KINDS: DocumentKind[] = [
  'prd',
  'implementation_plan',
  'architecture',
  'api_spec',
  'schema',
  'ticket',
  'wireframe',
  'screenshot',
  'code_sample',
  'research',
  'other',
];

const MAX_BYTES = 2 * 1024 * 1024;

export function isDocumentAuthority(value: string): value is DocumentAuthority {
  return AUTHORITIES.includes(value as DocumentAuthority);
}

export function isDocumentKind(value: string): value is DocumentKind {
  return KINDS.includes(value as DocumentKind);
}

export function extractDocumentText(
  fileName: string,
  mimeType: string | undefined,
  bytes: Buffer,
): string | undefined {
  const extension = extname(fileName).toLowerCase();
  const textLike =
    mimeType?.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/markdown' ||
    ['.md', '.txt', '.json', '.yaml', '.yml', '.csv', '.ts', '.tsx', '.js', '.jsx'].includes(
      extension,
    );
  if (!textLike) return undefined;
  try {
    return bytes.toString('utf8');
  } catch {
    return undefined;
  }
}

export function authoritativeConflictMessage(docs: TaskDocument[]): string | undefined {
  const authoritative = docs.filter((doc) => doc.authority === 'authoritative_requirement');
  if (authoritative.length < 2) return undefined;
  return `Multiple authoritative documents are attached (${authoritative
    .map((doc) => doc.fileName)
    .join(', ')}). Resolve conflicts with a typed clarification before writing.`;
}

export class DocumentService {
  private readonly docs: TaskDocumentRepository;

  constructor(
    db: SqliteDb,
    private readonly rootDir: string,
  ) {
    this.docs = new TaskDocumentRepository(db);
    mkdirSync(rootDir, { recursive: true });
  }

  list(taskId: string): TaskDocument[] {
    return this.docs.listByTask(taskId);
  }

  add(input: {
    taskId: string;
    fileName: string;
    mimeType?: string;
    authority: DocumentAuthority;
    kind: DocumentKind;
    bytes: Buffer;
  }): TaskDocument {
    if (input.bytes.byteLength === 0) throw new Error('Document is empty');
    if (input.bytes.byteLength > MAX_BYTES) {
      throw new Error(`Document exceeds ${MAX_BYTES} byte limit`);
    }
    const safeName = basename(input.fileName).replace(/[^\w.\-]+/g, '_');
    if (!safeName) throw new Error('fileName is required');

    const id = randomUUID();
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const taskDir = join(this.rootDir, input.taskId);
    mkdirSync(taskDir, { recursive: true });
    const storagePath = join(taskDir, `${id}_${safeName}`);
    writeFileSync(storagePath, input.bytes);

    const extractedText = extractDocumentText(safeName, input.mimeType, input.bytes);
    return this.docs.create({
      id,
      taskId: input.taskId,
      kind: input.kind,
      authority: input.authority,
      fileName: safeName,
      mimeType: input.mimeType,
      byteSize: input.bytes.byteLength,
      sha256,
      storagePath,
      extractedText,
      createdAt: new Date().toISOString(),
    });
  }
}
