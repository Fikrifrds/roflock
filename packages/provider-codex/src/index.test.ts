import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InvocationEvent } from '@roleflock/contracts';
import { describe, expect, it } from 'vitest';
import { CodexAdapter, codexExecArgs } from './index.js';

describe('Codex invocation sandbox', () => {
  it('makes reasoning turns explicitly read-only', () => {
    const args = codexExecArgs({
      invocationId: 'inv-read',
      prompt: 'review this',
      cwd: '/tmp/repository',
      model: 'gpt-5.6-terra',
      effort: 'medium',
    });

    expect(args).toContain('read-only');
    expect(args).toContain('/tmp/repository');
    expect(args).not.toContain('workspace-write');
    expect(args).not.toContain('danger-full-access');
  });

  it('limits writer turns to the leased worktree', () => {
    const args = codexExecArgs({
      invocationId: 'inv-write',
      prompt: 'implement the fix',
      cwd: '/tmp/source',
      permissionEnvelope: {
        worktree: '/tmp/leased-worktree',
        allowedPaths: ['**'],
        allowCommands: true,
      },
    });

    expect(args).toContain('workspace-write');
    expect(args).toContain('/tmp/leased-worktree');
    expect(args).not.toContain('/tmp/source');
    expect(args).toContain('--ephemeral');
    expect(args).not.toContain('danger-full-access');
  });
});

describe('reading why a turn failed', () => {
  /** A stand-in for `codex exec --json`, which reports failures on stdout. */
  async function invokeWithScript(stdoutLines: string[], exitCode: number, stderr = '') {
    const directory = await mkdtemp(join(tmpdir(), 'codex-fail-'));
    const binary = join(directory, 'codex');
    const script = [
      '#!/bin/sh',
      ...stdoutLines.map((line) => `printf '%s\\n' ${JSON.stringify(line)}`),
      ...(stderr ? [`printf '%s\\n' ${JSON.stringify(stderr)} >&2`] : []),
      `exit ${exitCode}`,
    ].join('\n');
    await writeFile(binary, script);
    await chmod(binary, 0o755);

    const events: InvocationEvent[] = [];
    for await (const event of new CodexAdapter(binary).invoke({
      invocationId: 'inv_fail',
      prompt: 'do something',
      cwd: directory,
    })) {
      events.push(event);
    }
    await rm(directory, { recursive: true, force: true });
    return events;
  }

  it('reports the reason Codex gave, not whatever landed on stderr', async () => {
    const events = await invokeWithScript(
      [
        '{"type":"thread.started","thread_id":"t1"}',
        '{"type":"error","message":"You\'ve hit your usage limit. Try again at 9:08 PM."}',
      ],
      1,
      // What Codex actually prints on stderr for an ordinary run — noise.
      'Reading additional input from stdin...',
    );
    const failure = events.at(-1);

    expect(failure).toMatchObject({ type: 'invocation.failed' });
    expect((failure as { error: { message: string } }).error.message).toContain('usage limit');
  });

  it('classifies an exhausted quota so the router can park the provider', async () => {
    const events = await invokeWithScript(
      ['{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit."}}'],
      1,
      'Reading additional input from stdin...',
    );

    // Quota is the one failure kind that changes routing rather than wording.
    // Read from stderr it was classified `unknown`, so the router kept retrying
    // a provider that could not succeed until its window reset.
    expect((events.at(-1) as { error: { code: string } }).error.code).toBe('CODEX_QUOTA_EXHAUSTED');
  });

  it('does not leak a failure message into the model output', async () => {
    const events = await invokeWithScript(
      ['{"type":"error","message":"You\'ve hit your usage limit."}'],
      1,
    );

    // It used to arrive as `model.output.delta`, so a quota notice was recorded
    // as something the model said.
    expect(events.filter((event) => event.type === 'model.output.delta')).toEqual([]);
  });

  it('still falls back to stderr when Codex reports nothing', async () => {
    const events = await invokeWithScript([], 1, 'codex: command failed catastrophically');

    expect((events.at(-1) as { error: { message: string } }).error.message).toContain(
      'catastrophically',
    );
  });

  it('leaves a successful turn alone', async () => {
    const events = await invokeWithScript(['{"type":"item.completed","item":{"text":"ok"}}'], 0);

    expect(events.at(-1)).toMatchObject({ type: 'invocation.completed' });
    expect(events.some((event) => event.type === 'model.output.delta')).toBe(true);
  });
});
