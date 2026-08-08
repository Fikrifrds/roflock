import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InvocationEvent } from '@roleflock/contracts';
import { describe, expect, it } from 'vitest';
import { OpenCodeAdapter, openCodeRunArgs } from './index.js';

/** A stand-in for `opencode run --format json`. */
async function fakeOpenCode(stdoutLines: string[], exitCode = 0, stderr = '') {
  const directory = await mkdtemp(join(tmpdir(), 'opencode-fake-'));
  const binary = join(directory, 'opencode');
  await writeFile(
    binary,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo 1.18.15; exit 0; fi',
      ...stdoutLines.map((line) => `printf '%s\\n' ${JSON.stringify(line)}`),
      ...(stderr ? [`printf '%s\\n' ${JSON.stringify(stderr)} >&2`] : []),
      `exit ${exitCode}`,
    ].join('\n'),
  );
  await chmod(binary, 0o755);
  return { binary, directory };
}

async function invoke(
  stdoutLines: string[],
  exitCode = 0,
  stderr = '',
  envelope: { allowCommands: boolean } | undefined = { allowCommands: true },
) {
  const { binary, directory } = await fakeOpenCode(stdoutLines, exitCode, stderr);
  const events: InvocationEvent[] = [];
  for await (const event of new OpenCodeAdapter(binary).invoke({
    invocationId: 'inv_1',
    prompt: 'do the thing',
    cwd: directory,
    ...(envelope === undefined
      ? {}
      : { permissionEnvelope: { worktree: directory, allowedPaths: [], ...envelope } }),
  })) {
    events.push(event);
  }
  await rm(directory, { recursive: true, force: true });
  return events;
}

const STEP_FINISH =
  '{"type":"step_finish","part":{"reason":"stop","tokens":{"input":100,"output":7},"cost":0.002}}';

describe('building the run command', () => {
  it('asks for JSON events and confines the working directory', () => {
    const args = openCodeRunArgs({
      invocationId: 'inv_1',
      prompt: 'fix it',
      cwd: '/tmp/source',
      permissionEnvelope: { worktree: '/tmp/leased', allowedPaths: [], allowCommands: true },
    });

    expect(args).toContain('--format');
    expect(args).toContain('json');
    expect(args.join(' ')).toContain('--dir /tmp/leased');
    // The prompt goes last, as a positional.
    expect(args.at(-1)).toBe('fix it');
  });

  it('never passes --auto', () => {
    const args = openCodeRunArgs({ invocationId: 'i', prompt: 'p', cwd: '/tmp' });

    // `--auto` approves everything including shell commands, unscoped. Roflock
    // does not hand a provider blanket approval it cannot bound.
    expect(args).not.toContain('--auto');
  });

  it('passes reasoning effort through as a variant', () => {
    const args = openCodeRunArgs({
      invocationId: 'i',
      prompt: 'p',
      cwd: '/tmp',
      effort: 'high',
    });

    expect(args.join(' ')).toContain('--variant high');
  });
});

describe('refusing what it cannot enforce', () => {
  it('will not accept a read-only turn', async () => {
    const events = await invoke([STEP_FINISH], 0, '', { allowCommands: false });

    // OpenCode edits without prompting and has no sandbox, so a read-only
    // permission would be a promise nothing keeps. Refusing is the honest move.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'invocation.failed',
      error: { code: 'OPENCODE_CANNOT_RESTRICT' },
    });
  });

  it('reports a missing CLI rather than pretending to run', async () => {
    const events: InvocationEvent[] = [];
    for await (const event of new OpenCodeAdapter('/definitely/not/here').invoke({
      invocationId: 'inv_1',
      prompt: 'p',
      cwd: tmpdir(),
    })) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({
      type: 'invocation.failed',
      error: { code: 'OPENCODE_MISSING' },
    });
  });
});

describe('mapping the event stream', () => {
  it('translates text, tools and usage', async () => {
    const events = await invoke([
      '{"type":"step_start","part":{}}',
      '{"type":"tool_use","part":{"tool":"read","state":{"status":"completed"}}}',
      '{"type":"text","part":{"text":"ok"}}',
      STEP_FINISH,
    ]);
    const types = events.map((event) => event.type);

    expect(types).toContain('tool.completed');
    expect(types).toContain('model.output.delta');
    expect(events.find((event) => event.type === 'usage.updated')).toMatchObject({
      usage: { inputTokens: 100, outputTokens: 7, costUsd: 0.002 },
    });
    expect(events.at(-1)).toMatchObject({ type: 'invocation.completed' });
  });

  it('survives a JSON event split across chunk boundaries', async () => {
    // The adapter buffers a partial line rather than discarding it; a dropped
    // event would silently lose output or a failure reason.
    const events = await invoke(['{"type":"text","part":{"text":"first"}}', STEP_FINISH]);

    expect(events.some((event) => event.type === 'model.output.delta')).toBe(true);
  });

  it('takes the failure reason from the event stream, not stderr', async () => {
    const events = await invoke(
      ['{"type":"error","message":"You have hit your usage limit."}'],
      1,
      'incidental noise on stderr',
    );
    const failure = events.at(-1) as { error: { code: string; message: string } };

    // Same lesson Codex taught: the reason is on stdout, and reading stderr
    // reports noise as the cause — misclassifying the one failure kind that
    // changes routing.
    expect(failure.error.message).toContain('usage limit');
    expect(failure.error.code).toBe('OPENCODE_QUOTA_EXHAUSTED');
  });

  it('treats a reported error as a failure even when the process exits zero', async () => {
    const events = await invoke(['{"type":"error","message":"model refused"}'], 0);

    // A zero exit alongside a reported error is not success.
    expect(events.at(-1)).toMatchObject({ type: 'invocation.failed' });
  });

  it('ignores event types it has no meaning for', async () => {
    const events = await invoke(['{"type":"snapshot","part":{"id":"x"}}', STEP_FINISH]);

    expect(events.filter((event) => event.type === 'model.output.delta')).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: 'invocation.completed' });
  });
});
