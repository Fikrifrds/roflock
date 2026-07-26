import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export async function createTempGitRepository(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roleflock-')); await exec('git', ['init', root]); await exec('git', ['-C', root, 'config', 'user.email', 'test@roleflock.local']); await exec('git', ['-C', root, 'config', 'user.name', 'RoleFlock Test']);
  await Promise.all(Object.entries(files).map(async ([path, content]) => { const full = join(root, path); const { mkdir } = await import('node:fs/promises'); await mkdir(join(full, '..'), { recursive: true }); await writeFile(full, content); }));
  await exec('git', ['-C', root, 'add', '.']); await exec('git', ['-C', root, 'commit', '-m', 'fixture']); return root;
}
export async function createFakeCli(output: string, exitCode = 0): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'roleflock-cli-')); const path = join(root, 'fake-cli');
  await writeFile(path, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(output)}\nexit ${exitCode}\n`); await chmod(path, 0o755); return path;
}
