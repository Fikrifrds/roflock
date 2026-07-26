import { access, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandError, runCommand } from './index.js';

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'rf-cmd-'));
  dirs.push(root);
  return root;
}

describe('command-runner', () => {
  it('rejects cwd outside sandboxRoot', async () => {
    const root = await sandbox();
    const outside = await mkdtemp(join(tmpdir(), 'rf-out-'));
    dirs.push(outside);
    await expect(
      runCommand({ command: 'echo', args: ['ok'], cwd: outside, sandboxRoot: root }),
    ).rejects.toThrow(/cwd escapes sandbox root/);
  });

  it('passes args literally without shell interpolation', async () => {
    const root = await sandbox();
    const marker = join(root, 'keep-me');
    await writeFile(marker, 'safe');
    const malicious = `; rm -rf ${marker}`;
    const result = await runCommand({
      command: 'echo',
      args: [malicious],
      cwd: root,
      sandboxRoot: root,
    });
    expect(result.stdout.trim()).toBe(malicious);
    await expect(access(marker)).resolves.toBeUndefined();
  });

  it('times out long-running commands', async () => {
    const root = await sandbox();
    try {
      await runCommand({
        command: process.platform === 'win32' ? 'ping' : 'sleep',
        args: process.platform === 'win32' ? ['127.0.0.1', '-n', '5'] : ['2'],
        cwd: root,
        sandboxRoot: root,
        timeoutMs: 100,
      });
      expect.unreachable('expected command timeout');
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError);
      expect((error as CommandError).result.timedOut).toBe(true);
    }
  });
});
