import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeDriver } from '@roleflock/provider-claude';
import { codexDriver } from '@roleflock/provider-codex';
import { openAiCompatibleDriver } from '@roleflock/provider-custom';
import type { AgentDriver } from '@roleflock/provider-core';
import { afterEach, describe, expect, it } from 'vitest';
import { runDriverConformance } from './driver-conformance.js';

/**
 * Every shipped driver must pass conformance.
 *
 * Run against a fake CLI rather than a real one: the point is that each
 * integration tells the truth about itself, and that is checkable without
 * Codex or Claude Code being installed. What this does *not* prove is that the
 * real CLIs behave as their adapters expect — that needs those CLIs present,
 * and is why `ProviderAdapter` compatibility is not being removed yet.
 */

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

/**
 * A stand-in binary that emits what the real CLI emits.
 *
 * A fake that prints nothing would let a driver pass conformance while claiming
 * capabilities its real counterpart delivers and the fake never exercises. These
 * mirror the streams observed from the installed CLIs.
 */
function fakeCli(stdoutLines: readonly string[] = []): string {
  const directory = mkdtempSync(join(tmpdir(), 'roflock-fake-cli-'));
  directories.push(directory);
  const path = join(directory, 'fake-cli');
  writeFileSync(
    path,
    [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then echo 1.0.0; exit 0; fi',
      ...stdoutLines.map((line) => `printf '%s\\n' ${JSON.stringify(line)}`),
      'exit 0',
    ].join('\n'),
  );
  chmodSync(path, 0o755);
  return path;
}

/** Codex reports usage nested under `usage`, per its `--json` stream. */
const CODEX_STREAM = [
  '{"type":"item.completed","item":{"text":"ok"},"usage":{"input_tokens":10,"output_tokens":2}}',
];

/** Claude reports usage on its result event. */
const CLAUDE_STREAM = [
  '{"type":"assistant","message":{"content":[{"type":"text","text":"ok"}]}}',
  '{"type":"result","usage":{"input_tokens":10,"output_tokens":2}}',
];

const options = {
  request: (overrides = {}) => ({
    invocationKey: 'inv_conformance',
    objective: 'investigate the failing test',
    workspacePath: tmpdir(),
    permissions: { workspaceWrite: true, network: false },
    ...overrides,
  }),
};

function shipped(): Array<[string, () => AgentDriver]> {
  return [
    ['codex', () => codexDriver(fakeCli(CODEX_STREAM))],
    ['claude', () => claudeDriver(fakeCli(CLAUDE_STREAM))],
    [
      'openai-compatible',
      () =>
        openAiCompatibleDriver(
          'custom',
          'http://127.0.0.1:9/v1/chat/completions',
          'test-key',
          'local-model',
          // Refuses immediately, standing in for an endpoint that is not there.
          async () => {
            throw new Error('connection refused');
          },
        ),
    ],
  ];
}

describe.each(shipped())('the %s driver', (_name, build) => {
  it('passes conformance', async () => {
    expect(await runDriverConformance(build(), options)).toEqual([]);
  });

  it('never claims cancellation it cannot prove', async () => {
    const driver = build();

    // Each of these spawns a local process or calls a remote endpoint. Neither
    // can observe that the far side stopped, and saying otherwise would tell a
    // user their work ended while a paid provider carried on.
    expect((await driver.capabilities()).cancellation).toBe('local-process');
    expect((await driver.interrupt!('inv_conformance')).stopped).toBe(false);
  });

  it('keeps detection and authentication separate', async () => {
    const availability = await build().detect();

    // An installed CLI nobody has logged into is a common state, and reporting
    // it as ready sends a run to a provider that will refuse it.
    expect(typeof availability.detected).toBe('boolean');
    expect(typeof availability.authenticated).toBe('boolean');
    if (availability.authenticated) expect(availability.detected).toBe(true);
  });

  it('refuses a write objective the run was not granted', async () => {
    const events = [];
    for await (const event of build().start({
      ...options.request(),
      objective: 'modify the payment module',
      permissions: { workspaceWrite: false, network: false },
    })) {
      events.push(event);
    }

    expect(events.at(-1)).toMatchObject({ type: 'settled', outcome: 'refused' });
  });
});

describe('what conformance here does and does not establish', () => {
  it('does not require the real CLI to be installed', async () => {
    // Deliberate: a driver's honesty about itself is checkable offline. Whether
    // the real Codex behaves as its adapter expects is a different question,
    // needing the real binary — which is why ProviderAdapter stays in place.
    const driver = codexDriver('/definitely/not/a/real/binary');

    const availability = await driver.detect();
    expect(availability.authenticated).toBe(false);
    expect(await runDriverConformance(driver, options)).toEqual([]);
  });
});
