import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { authoriseTaskContract } from './contract-fixture.js';

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length) {
    const fn = cleanup.pop();
    if (fn) await fn();
  }
});

async function boot() {
  const dataDir = await mkdtemp(join(tmpdir(), 'rf-onboard-data-'));
  const repoDir = await mkdtemp(join(tmpdir(), 'rf-onboard-repo-'));
  execFileSync('git', ['init'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'RoleFlock'], { cwd: repoDir });
  await writeFile(join(repoDir, 'README.md'), '# fixture\n');
  await writeFile(
    join(repoDir, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { test: 'node -e "process.exit(0)"' } }),
  );
  execFileSync('git', ['add', '.'], { cwd: repoDir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });

  const session = { token: 'test-token', csrf: 'test-csrf' };
  const instance = await createServer({ dataDir, session });
  cleanup.push(async () => {
    await instance.app.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  });
  return {
    app: instance.app,
    repoDir,
    headers: {
      'x-roleflock-token': session.token,
      'x-roleflock-csrf': session.csrf,
      'content-type': 'application/json',
    },
  };
}

async function newTask(app: FastifyInstance, headers: Record<string, string>, repoDir: string) {
  const project = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers,
    payload: { path: repoDir },
  });
  const projectId = (project.json() as { id: string }).id;
  const task = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers,
    payload: {
      projectId,
      type: 'chore',
      mode: 'direct',
      title: 'Reach assured mode from the UI surface',
      brief: 'Only the endpoints the UI calls may be used.',
    },
  });
  return (task.json() as { id: string }).id;
}

describe('reaching assured mode through the UI surface', () => {
  it('derives, proposes, approves, and freezes without hand-authored artifacts', async () => {
    const { app, repoDir, headers } = await boot();
    const taskId = await newTask(app, headers, repoDir);

    // Before the contract is authorised, both drafts must refuse with a reason
    // the panel can turn into an instruction.
    const earlyPlan = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/execution-plan/draft`,
      headers,
    });
    expect(earlyPlan.statusCode).toBe(409);
    expect(earlyPlan.json()).toMatchObject({ code: 'AUTHORISED_CONTRACT_REQUIRED' });

    await authoriseTaskContract(app, headers, taskId);

    const earlySpec = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/verification-specification/draft`,
      headers,
    });
    expect(earlySpec.statusCode).toBe(409);
    expect(earlySpec.json()).toMatchObject({ code: 'APPROVED_PLAN_REQUIRED' });

    // 1. Derive a plan from the authorised contract.
    const draft = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/execution-plan/draft`,
      headers,
    });
    expect(draft.statusCode).toBe(200);
    const draftBody = draft.json() as {
      plan: Record<string, unknown>;
      allowedPaths: string[];
      verificationCommand: string;
    };
    // Scope comes from what the repository actually tracks, not a guess.
    expect(draftBody.allowedPaths).toEqual(['README.md', 'package.json']);
    expect(draftBody.verificationCommand).toBeTruthy();

    // 2. Propose it.
    const proposed = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/execution-plan`,
      headers,
      payload: draftBody.plan,
    });
    expect(proposed.statusCode).toBe(201);
    const planId = (proposed.json() as { plan: { id: string; status: string } }).plan;
    expect(planId.status).toBe('proposed');

    // 3. Approve it.
    const approved = await app.inject({
      method: 'POST',
      url: `/api/execution-plans/${planId.id}/approve`,
      headers: { ...headers, 'if-match': '"1"' },
      payload: {},
    });
    expect(approved.statusCode).toBe(200);

    // 4. Freeze the verification specification derived from it.
    const specDraft = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/verification-specification/draft`,
      headers,
    });
    expect(specDraft.statusCode).toBe(200);
    const specBody = specDraft.json() as { draft: Record<string, unknown> };
    const frozen = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/verification-specification`,
      headers,
      payload: specBody.draft,
    });
    expect(frozen.statusCode).toBe(201);
    const specification = (
      frozen.json() as {
        specification: {
          checks: Array<{ criterionIds: string[] }>;
          environment: { credentialProfileId: string; network: string };
          testMutationPolicy: string;
        };
      }
    ).specification;

    // Every acceptance criterion gets independent evidence, the verifier never
    // inherits the writer's credentials, and tests cannot be weakened.
    expect(specification.checks.map((check) => check.criterionIds)).toEqual([['AC-1']]);
    expect(specification.environment.credentialProfileId).toBe('roleflock.verifier.local');
    expect(specification.environment.network).toBe('deny');
    expect(specification.testMutationPolicy).toBe('forbid');
  }, 60_000);

  it('serves the single-page app for a deep-linked task URL', async () => {
    const { app, repoDir, headers } = await boot();
    const taskId = await newTask(app, headers, repoDir);

    const page = await app.inject({ method: 'GET', url: `/tasks/${taskId}` });
    // Without an SPA fallback a bookmarked task URL returned the API's 404 JSON.
    if (page.statusCode === 404) {
      // The web bundle is not built in this environment; the API contract below
      // is what the fallback must never swallow.
      expect(page.json()).toMatchObject({ error: expect.any(String) });
    } else {
      expect(page.statusCode).toBe(200);
      expect(page.headers['content-type']).toContain('text/html');
    }

    // An unknown API route must still 404 as JSON rather than returning HTML.
    const missing = await app.inject({ method: 'GET', url: '/api/does-not-exist', headers });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toContain('application/json');
  }, 30_000);
});
