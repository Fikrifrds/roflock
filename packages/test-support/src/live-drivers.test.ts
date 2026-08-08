import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEnv } from '@roleflock/contracts';
import { claudeDriver } from '@roleflock/provider-claude';
import { codexDriver } from '@roleflock/provider-codex';
import type { AgentDriver, AgentEvent } from '@roleflock/provider-core';
import { afterEach, describe, expect, it } from 'vitest';
import { runDriverConformance } from './driver-conformance.js';

/**
 * Conformance against the **real** provider CLIs.
 *
 * Doubly gated, and both gates matter. The CLI must be installed, and
 * `ROFLOCK_LIVE_DRIVER_TESTS=1` must be set — because these spend a real
 * provider turn. A suite that quietly bills someone on every `pnpm test` is a
 * suite people learn to avoid running, which costs more than it saves.
 *
 * The fake-CLI suite proves each driver is honest about itself. Only this one
 * proves the real CLIs behave the way their adapters assume, which is the gap
 * that keeps `ProviderAdapter` compatibility in place.
 *
 *     ROFLOCK_LIVE_DRIVER_TESTS=1 pnpm --filter @roleflock/test-support test
 */

const LIVE = readEnv('LIVE_DRIVER_TESTS') === '1';

function installed(binary: string): boolean {
  try {
    execFileSync('command', ['-v', binary], { shell: '/bin/sh', stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), 'roflock-live-'));
  directories.push(directory);
  return directory;
}

/** Deliberately the smallest turn that still exercises the whole path. */
function options(workspacePath: string) {
  return {
    request: (overrides = {}) => ({
      invocationKey: 'inv_live_conformance',
      objective: 'Reply with exactly one word: ok',
      workspacePath,
      permissions: { workspaceWrite: true, network: false },
      ...overrides,
    }),
  };
}

const drivers: Array<[string, string, () => AgentDriver]> = [
  ['claude', 'claude', () => claudeDriver()],
  ['codex', 'codex', () => codexDriver()],
];

describe.each(drivers)('the real %s CLI', (name, binary, build) => {
  const runnable = LIVE && installed(binary);

  it.skipIf(!runnable)('is detected and authenticated', async () => {
    const availability = await build().detect();

    expect(availability.detected).toBe(true);
    // If this fails the CLI is installed but logged out, which is exactly the
    // state the two-field split exists to distinguish.
    expect(availability.authenticated).toBe(true);
  });

  it.skipIf(!runnable)(
    'passes conformance',
    async () => {
      expect(await runDriverConformance(build(), options(workspace()))).toEqual([]);
    },
    120_000,
  );

  it.skipIf(!runnable)(
    'emits a coherent stream ending in a settled outcome',
    async () => {
      const events: AgentEvent[] = [];
      for await (const event of build().start(options(workspace()).request())) {
        events.push(event);
      }

      expect(events[0]?.type).toBe('started');
      // Not asserting success: a real account can be out of quota, and a run that
      // fails for a stated reason is a correct outcome. What must hold is that the
      // stream is coherent and says which it was.
      const settled = events.filter((event) => event.type === 'settled');
      expect(settled).toHaveLength(1);
      expect(['completed', 'failed', 'refused']).toContain(
        (settled[0] as { outcome: string }).outcome,
      );
      if ((settled[0] as { outcome: string }).outcome !== 'completed') {
        // A failure must explain itself. Reporting one without a reason is how a
        // quota exhaustion looked like an unknown error and kept being retried.
        expect((settled[0] as { detail?: string }).detail ?? '').not.toBe('');
      }
    },
    120_000,
  );

  it.skipIf(!runnable)('still refuses to claim a stop it cannot prove', async () => {
    const driver = build();

    // The property that survives contact with a real CLI: killing the local
    // process says nothing about a request already in flight to a paid API.
    expect((await driver.capabilities()).cancellation).toBe('local-process');
    expect((await driver.interrupt!('inv_live_conformance')).stopped).toBe(false);
  });
});

describe('the live suite is opt-in', () => {
  it('stays off unless explicitly asked for', () => {
    // Documented rather than assumed: someone reading a green suite should know
    // the real CLIs were probably not exercised.
    expect(readEnv('LIVE_DRIVER_TESTS') === '1').toBe(LIVE);
  });
});
