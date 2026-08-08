import { createHash } from 'node:crypto';
import { mkdtempSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DaemonLifecycle } from './daemon-lifecycle.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function directory() {
  const value = mkdtempSync(join(tmpdir(), 'roflock-daemon-lifecycle-'));
  directories.push(value);
  return value;
}

describe('CLI-owned daemon lifecycle', () => {
  it('starts, verifies, and gracefully stops only its owned daemon', async () => {
    const dataDir = directory();
    const entry = join(dataDir, 'daemon.js');
    writeFileSync(entry, '// fixture');
    let running = false;
    let alive = false;
    let ownerId = '';
    let quietLaunch: string | undefined;
    let signalled: NodeJS.Signals | undefined;
    const lifecycle = new DaemonLifecycle({
      dataDir,
      daemonEntry: entry,
      sleep: async () => {},
      spawnDaemon: ({ env }) => {
        running = true;
        alive = true;
        ownerId = createHash('sha256').update(env.ROFLOCK_OWNER_TOKEN!).digest('hex');
        quietLaunch = env.ROFLOCK_QUIET_LAUNCH;
        writeFileSync(
          join(dataDir, 'session.json'),
          JSON.stringify({ token: 't'.repeat(32), csrf: 'c'.repeat(16) }),
        );
        return { pid: 4123, unref: () => {} };
      },
      isAlive: () => alive,
      signal: (_pid, signal) => {
        signalled = signal;
        running = false;
        alive = false;
      },
      fetch: (async (url: string | URL | Request) => {
        if (!running) throw new Error('offline');
        return new Response(
          JSON.stringify(
            String(url).endsWith('/api/health')
              ? { ok: true, service: 'roleflock-daemon' }
              : { ownerId },
          ),
          { status: 200 },
        );
      }) as typeof fetch,
    });

    expect(await lifecycle.start()).toMatchObject({
      state: 'running',
      ownership: 'owned',
      pid: 4123,
    });
    expect(statSync(join(dataDir, 'daemon-owner.json')).mode & 0o777).toBe(0o600);
    expect(quietLaunch).toBe('1');
    expect(await lifecycle.stop()).toMatchObject({ state: 'stopped', ownership: 'none' });
    expect(signalled).toBe('SIGTERM');
  });

  it('connects to an existing daemon without claiming or spawning it', async () => {
    const dataDir = directory();
    let spawned = false;
    const lifecycle = new DaemonLifecycle({
      dataDir,
      daemonEntry: join(dataDir, 'missing.js'),
      spawnDaemon: () => {
        spawned = true;
        return { pid: 1, unref: () => {} };
      },
      fetch: (async () =>
        new Response(JSON.stringify({ ok: true, service: 'roleflock-daemon' }), {
          status: 200,
        })) as typeof fetch,
    });

    expect(await lifecycle.start()).toMatchObject({
      state: 'running',
      ownership: 'external',
    });
    expect(spawned).toBe(false);
    await expect(lifecycle.stop()).rejects.toThrow(/refusing to signal/i);
  });

  it('refuses to stop when the authenticated ownership proof does not match', async () => {
    const dataDir = directory();
    writeFileSync(
      join(dataDir, 'daemon-owner.json'),
      JSON.stringify({
        version: 1,
        pid: 99,
        ownerId: 'expected',
        baseUrl: 'http://127.0.0.1:4178',
        daemonEntry: '/fixture/daemon.js',
        startedAt: '2026-08-09T00:00:00.000Z',
      }),
    );
    writeFileSync(
      join(dataDir, 'session.json'),
      JSON.stringify({ token: 't'.repeat(32), csrf: 'c'.repeat(16) }),
    );
    let signalled = false;
    const lifecycle = new DaemonLifecycle({
      dataDir,
      isAlive: () => true,
      signal: () => {
        signalled = true;
      },
      fetch: (async (url: string | URL | Request) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/api/health')
              ? { ok: true, service: 'roleflock-daemon' }
              : { ownerId: 'different' },
          ),
          { status: 200 },
        )) as typeof fetch,
    });

    await expect(lifecycle.stop()).rejects.toThrow(/did not prove CLI ownership/i);
    expect(signalled).toBe(false);
  });
});
