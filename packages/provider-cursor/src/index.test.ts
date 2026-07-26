import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CursorWriterAdapter,
  assertPathAllowed,
  createFsCursorWriter,
} from './index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.pop();
    if (fn) await fn();
  }
});

describe('CursorWriterAdapter sandbox', () => {
  it('allows writes only inside the permission envelope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rf-cursor-'));
    cleanup.push(async () => rm(root, { recursive: true, force: true }));
    const adapter = new CursorWriterAdapter(createFsCursorWriter());
    const envelope = {
      worktree: root,
      allowedPaths: ['ROLEFLOCK_FIX.md'],
      allowCommands: false,
    };

    await adapter.write('ROLEFLOCK_FIX.md', 'ok\n', envelope);
    await expect(readFile(join(root, 'ROLEFLOCK_FIX.md'), 'utf8')).resolves.toBe('ok\n');

    await expect(adapter.write('../escape.txt', 'nope', envelope)).rejects.toThrow(/Write denied/);
    await expect(adapter.write('secrets.env', 'nope', envelope)).rejects.toThrow(/Write denied/);
  });

  it('assertPathAllowed rejects path traversal', () => {
    expect(() =>
      assertPathAllowed(
        { worktree: '/tmp/work', allowedPaths: ['a.md'] },
        '../outside.md',
      ),
    ).toThrow(/Write denied/);
  });
});
