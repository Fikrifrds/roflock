import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase } from '@roleflock/database';
import { verifyEvidenceBundle } from '@roleflock/evidence';
import { createServer } from '../src/server.js';

const servers: Awaited<ReturnType<typeof createServer>>[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(({ app }) => app.close().catch(() => undefined)));
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'rf-export-data-'));
  const repoDir = await mkdtemp(join(tmpdir(), 'rf-export-repo-'));
  dirs.push(dataDir, repoDir);
  execFileSync('git', ['init'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'RoleFlock'], { cwd: repoDir });
  await writeFile(join(repoDir, 'README.md'), '# fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });
  const session = { token: 'test-token', csrf: 'test-csrf' };
  const instance = await createServer({ dataDir, session });
  servers.push(instance);
  const headers = {
    'x-roleflock-token': session.token,
    'x-roleflock-csrf': session.csrf,
    'content-type': 'application/json',
  };
  const project = await instance.app.inject({
    method: 'POST',
    url: '/api/projects',
    headers,
    payload: { path: repoDir },
  });
  const projectId = (project.json() as { id: string }).id;
  const task = await instance.app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers,
    payload: {
      projectId,
      type: 'feature',
      title: 'Export fixture',
      brief: 'Build export pack with secret apiKey sk-abcdefghijklmnopqrstuvwxyz',
      mode: 'direct',
    },
  });
  return {
    app: instance.app,
    headers,
    dataDir,
    taskId: (task.json() as { id: string }).id,
  };
}

describe('export and data controls', () => {
  it('exports hashed evidence and redacted audit packs', async () => {
    const { app, headers, taskId } = await fixture();
    const evidence = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/export/evidence`,
      headers,
    });
    expect(evidence.statusCode).toBe(200);
    const evidenceBody = evidence.json() as Parameters<typeof verifyEvidenceBundle>[0];
    expect(verifyEvidenceBundle(evidenceBody)).toBe(true);

    const audit = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/export/audit`,
      headers,
    });
    expect(audit.statusCode).toBe(200);
    const auditText = JSON.stringify(audit.json());
    expect(auditText).not.toMatch(/sk-[a-zA-Z0-9-]{12,}/);

    const diagnostics = await app.inject({
      method: 'GET',
      url: '/api/diagnostics/export',
      headers,
    });
    expect(diagnostics.statusCode).toBe(200);
    expect((diagnostics.json() as { product: string }).product).toBe('RoleFlock');
  });

  it('backs up and deletes local data with confirmation', async () => {
    const { app, headers, dataDir } = await fixture();
    const backup = await app.inject({
      method: 'POST',
      url: '/api/data/backup',
      headers,
      payload: {},
    });
    expect(backup.statusCode).toBe(200);
    const backupDir = (backup.json() as { backupDir: string }).backupDir;
    const backupPath = join(backupDir, 'roleflock.db');
    expect(existsSync(backupPath)).toBe(true);
    const restored = openMigratedDatabase(backupPath);
    try {
      expect(restored.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(
        (restored.prepare('SELECT COUNT(*) AS count FROM tasks').get() as { count: number }).count,
      ).toBe(1);
    } finally {
      restored.close();
    }

    const denied = await app.inject({
      method: 'POST',
      url: '/api/data/delete',
      headers,
      payload: { confirm: 'nope' },
    });
    expect(denied.statusCode).toBe(400);

    await writeFile(join(dataDir, 'provider-secrets.key'), 'provider-secret');
    await writeFile(join(dataDir, 'runner-signing.key'), 'signing-secret');

    const deleted = await app.inject({
      method: 'POST',
      url: '/api/data/delete',
      headers,
      payload: { confirm: 'DELETE_LOCAL_DATA' },
    });
    expect(deleted.statusCode).toBe(200);
    expect(existsSync(join(dataDir, 'roleflock.db'))).toBe(false);
    expect(existsSync(join(dataDir, 'provider-secrets.key'))).toBe(false);
    expect(existsSync(join(dataDir, 'runner-signing.key'))).toBe(false);
  });
});
