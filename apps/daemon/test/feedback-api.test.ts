import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

describe('Feedback API', () => {
  it('persists and routes cosmetic feedback to planner, never executor', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'roleflock-feedback-api-'));
    const repositoryDir = await mkdtemp(join(tmpdir(), 'roleflock-feedback-repo-'));
    execFileSync('git', ['init'], { cwd: repositoryDir });
    execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], {
      cwd: repositoryDir,
    });
    execFileSync('git', ['config', 'user.name', 'RoleFlock Test'], {
      cwd: repositoryDir,
    });
    await writeFile(join(repositoryDir, 'README.md'), '# feedback\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repositoryDir });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repositoryDir });
    const session = { token: 'test-token', csrf: 'test-csrf' };
    const server = await createServer({ dataDir, session });
    cleanups.push(async () => {
      await server.app.close();
      await rm(dataDir, { recursive: true, force: true });
      await rm(repositoryDir, { recursive: true, force: true });
    });
    const headers = {
      'x-roleflock-token': session.token,
      'x-roleflock-csrf': session.csrf,
      'x-roleflock-actor-id': 'user_fikri',
      'content-type': 'application/json',
    };
    const project = (
      await server.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers,
        payload: { path: repositoryDir },
      })
    ).json() as { id: string };
    const task = (
      await server.app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers,
        payload: {
          projectId: project.id,
          title: 'Button feedback',
          brief: 'Polish checkout.',
        },
      })
    ).json() as { id: string };

    const created = await server.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/feedback`,
      headers: { ...headers, 'idempotency-key': 'feedback-1' },
      payload: { text: 'Tolong perbaiki warna tombol dan spacing-nya.' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      feedback: {
        classification: 'interactive_cosmetic_change',
        routedRole: 'planner',
        status: 'routed',
      },
      replayed: false,
    });

    const blocked = await server.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/feedback`,
      headers: { ...headers, 'idempotency-key': 'feedback-2' },
      payload: { text: 'Make it blue.', targetRole: 'executor' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: 'RAW_FEEDBACK_EXECUTOR_FORBIDDEN' });

    const listed = await server.app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/feedback`,
      headers,
    });
    expect(listed.json()).toMatchObject({
      feedback: [
        {
          text: 'Tolong perbaiki warna tombol dan spacing-nya.',
          routedRole: 'planner',
        },
      ],
    });
  });
});
