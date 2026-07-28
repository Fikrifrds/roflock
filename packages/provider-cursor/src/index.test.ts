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
  extractStreamText,
  parseCursorModelList,
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

  it('fails closed when Agent CLI is forced off', async () => {
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

    expect(events.some((e) => e.type === 'invocation.failed')).toBe(true);
    await expect(readFile(join(root, 'ROLEFLOCK_FIX.md'), 'utf8')).rejects.toThrow();
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

describe('read-only Cursor turns', () => {
  it('says so plainly when a reasoning turn has no Agent CLI to run on', async () => {
    // Cursor carries most of the model catalogue, so planner and verifier must
    // be able to run there without a write envelope. Without the CLI the
    // leased-write fallback cannot stand in for a reasoning turn, and pretending
    // otherwise would write the prompt to a file and call it an answer.
    vi.stubEnv('ROLEFLOCK_CURSOR_AGENT', '0');
    const adapter = new CursorWriterAdapter(createFsCursorWriter());

    await expect(async () => {
      for await (const _event of adapter.invoke({
        invocationId: 'inv-ro',
        prompt: 'read only',
        cwd: tmpdir(),
      })) {
        void _event;
      }
    }).rejects.toThrow(/Cursor Agent CLI is required/);
  });

  it('still refuses to write without an envelope', async () => {
    const adapter = new CursorWriterAdapter(createFsCursorWriter());
    await expect(adapter.write('x.md', 'content', undefined as unknown as never)).rejects.toThrow();
  });
});

describe('extractStreamText', () => {
  it('decodes write tool file text instead of dumping raw JSON', () => {
    const line = JSON.stringify({
      type: 'tool_call',
      subtype: 'started',
      tool_call: {
        writeToolCall: {
          args: { path: 'index.html', fileText: '<!doctype html>\n<html>\n' },
        },
      },
    });
    expect(extractStreamText(line)).toContain('<!doctype html>\n<html>\n');
    expect(extractStreamText(line)).not.toContain('\\n');
  });

  it('keeps assistant prose and ignores incomplete JSON lines', () => {
    expect(
      extractStreamText(
        JSON.stringify({
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
        }),
      ),
    ).toBe('Done.');
    expect(
      extractStreamText('{"type":"tool_call","tool_call":{"writeToolCall":{"args":{"fileText":"a\\nb'),
    ).toBeUndefined();
  });

  it('skips terminal result frames that repeat assistant text', () => {
    expect(
      extractStreamText(JSON.stringify({ type: 'result', subtype: 'success', result: 'Done.' })),
    ).toBeUndefined();
  });
});

describe('parseCursorModelList', () => {
  it('recovers the effort and family encoded in a Cursor model id', () => {
    const models = parseCursorModelList(
      [
        'Available models',
        '',
        'auto - Auto (default)',
        'claude-opus-5-high - Opus 5 1M',
        'claude-opus-5-low-fast - Opus 5 1M Low Fast',
        'gpt-5.6-terra-medium - GPT-5.6 Terra 1M',
        'not a model line',
      ].join('\n'),
    );

    expect(models.map((m) => m.id)).toEqual([
      'auto',
      'claude-opus-5-high',
      'claude-opus-5-low-fast',
      'gpt-5.6-terra-medium',
    ]);
    expect(models[1]).toMatchObject({ effort: 'high', family: 'claude-opus-5' });
    // `-fast` is a delivery variant, not an effort, so the family is the same.
    expect(models[2]).toMatchObject({ effort: 'low', family: 'claude-opus-5' });
    expect(models[3]).toMatchObject({ effort: 'medium', family: 'gpt-5.6-terra' });
    expect(models[0]?.effort).toBeUndefined();
  });

  it('ignores prose and duplicates', () => {
    const models = parseCursorModelList('a - A\na - A again\n\nsome prose here.');
    expect(models).toHaveLength(1);
  });
});
