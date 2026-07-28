import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCommandArgv } from '@roleflock/command-runner';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverVerificationCommand } from '../src/services/verification-command.js';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe('verification command discovery', () => {
  it('offers a local structural check for a dependency-free HTML app', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rf-html-verification-'));
    cleanup.push(() => rm(root, { recursive: true, force: true }));
    await writeFile(
      join(root, 'index.html'),
      '<!doctype html><html><body><script>console.log("ok")</script></body></html>',
    );

    const command = await discoverVerificationCommand(root);

    expect(command).toContain("fs.readFileSync('index.html'");
    expect(parseCommandArgv(command!)[0]).toBe('node');
    expect(parseCommandArgv(command!)[1]).toBe('-e');
  });
});
