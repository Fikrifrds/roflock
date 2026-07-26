import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase } from '@roleflock/database';
import {
  DocumentService,
  authoritativeConflictMessage,
  extractDocumentText,
} from '../src/services/documents.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('document service', () => {
  it('stores original bytes with sha256 and extracts text', () => {
    const root = mkdtempSync(join(tmpdir(), 'rf-docs-'));
    dirs.push(root);
    const db = openMigratedDatabase(join(root, 'db.sqlite'));
    const service = new DocumentService(db, join(root, 'docs'));
    const stored = service.add({
      taskId: 'task_1',
      fileName: 'prd.md',
      mimeType: 'text/markdown',
      authority: 'authoritative_requirement',
      kind: 'prd',
      bytes: Buffer.from('# Auth\nUse magic links.\n', 'utf8'),
    });
    expect(stored.sha256).toHaveLength(64);
    expect(stored.extractedText).toContain('magic links');
    expect(readFileSync(stored.storagePath, 'utf8')).toContain('magic links');
  });

  it('flags multiple authoritative documents', () => {
    const root = mkdtempSync(join(tmpdir(), 'rf-docs-'));
    dirs.push(root);
    const db = openMigratedDatabase(join(root, 'db.sqlite'));
    const service = new DocumentService(db, join(root, 'docs'));
    service.add({
      taskId: 'task_1',
      fileName: 'prd.md',
      authority: 'authoritative_requirement',
      kind: 'prd',
      bytes: Buffer.from('A', 'utf8'),
    });
    service.add({
      taskId: 'task_1',
      fileName: 'plan.md',
      authority: 'authoritative_requirement',
      kind: 'implementation_plan',
      bytes: Buffer.from('B', 'utf8'),
    });
    expect(authoritativeConflictMessage(service.list('task_1'))).toMatch(/Multiple authoritative/);
  });

  it('skips binary extraction', () => {
    expect(extractDocumentText('shot.png', 'image/png', Buffer.from([1, 2, 3]))).toBeUndefined();
  });
});
