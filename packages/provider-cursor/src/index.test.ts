import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CursorWriterAdapter,
  assertChangedPathsAllowed,
  assertPathAllowed,
  createFsCursorWriter,
  discoverCursor,
} from './index.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.pop();
    if (fn) await fn();
  }
  vi.unstubAllEnvs();
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
      assertPathAllowed({ worktree: '/tmp/work', allowedPaths: ['a.md'] }, '../outside.md'),
    ).toThrow(/Write denied/);
  });

  it('allows whole-tree envelopes with ** and validates changed files', () => {
    const envelope = { worktree: '/tmp/work', allowedPaths: ['**'] };
    expect(assertPathAllowed(envelope, 'src/add.js')).toContain('src/add.js');
    expect(() => assertPathAllowed(envelope, '../escape.js')).toThrow(/Write denied/);
    expect(() => assertChangedPathsAllowed(envelope, ['src/a.js', '../x'])).toThrow(/Write denied/);
    expect(() => assertChangedPathsAllowed(envelope, ['src/a.js'])).not.toThrow();
  });

  it('falls back to leased write when Agent CLI is forced off', async () => {
    vi.stubEnv('ROLEFLOCK_CURSOR_AGENT', '0');
    const root = await mkdtemp(join(tmpdir(), 'rf-cursor-fb-'));
    cleanup.push(async () => rm(root, { recursive: true, force: true }));
    const adapter = new CursorWriterAdapter(createFsCursorWriter());
    const envelope = {
      worktree: root,
      allowedPaths: ['ROLEFLOCK_FIX.md'],
      allowCommands: false,
    };

    const events: Array<{ type: string }> = [];
    for await (const event of adapter.invoke({
      invocationId: 'inv-1',
      prompt: 'fix body',
      cwd: root,
      permissionEnvelope: envelope,
    })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === 'invocation.completed')).toBe(true);
    await expect(readFile(join(root, 'ROLEFLOCK_FIX.md'), 'utf8')).resolves.toBe('fix body');
  });

  async function writeFakeBinary(path: string, help: string): Promise<string> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `#!/bin/sh\ncat <<'EOF'\n${help}\nEOF\n`, 'utf8');
    await chmod(path, 0o755);
    return path;
  }

  it('rejects another vendor’s agent by path', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rf-cursor-grok-'));
    cleanup.push(async () => rm(root, { recursive: true, force: true }));
    const binary = await writeFakeBinary(
      join(root, '.grok', 'bin', 'agent'),
      'usage: agent --print --force',
    );

    const discovery = await discoverCursor(binary);
    expect(discovery.status).toBe('missing');
  });

  it('rejects another vendor’s agent by help output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rf-cursor-help-'));
    cleanup.push(async () => rm(root, { recursive: true, force: true }));
    const binary = await writeFakeBinary(
      join(root, 'bin', 'agent'),
      'Grok CLI\nusage: agent --print --force',
    );

    const discovery = await discoverCursor(binary);
    expect(discovery.status).toBe('missing');
  });

  it('does not fall back to PATH when the configured binary is wrong', async () => {
    const discovery = await discoverCursor(join(tmpdir(), 'rf-cursor-does-not-exist', 'agent'));
    expect(discovery.status).toBe('missing');
    expect(discovery.binary).toBeUndefined();
    expect(discovery.detail).toMatch(/not found/i);
  });

  it('accepts a real Cursor Agent CLI', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rf-cursor-ok-'));
    cleanup.push(async () => rm(root, { recursive: true, force: true }));
    const binary = await writeFakeBinary(
      join(root, 'bin', 'cursor-agent'),
      'Cursor Agent\nusage: cursor-agent --print --force',
    );

    const discovery = await discoverCursor(binary);
    expect(discovery.status).toBe('ready');
    expect(discovery.binary).toBe(binary);
  });
});
