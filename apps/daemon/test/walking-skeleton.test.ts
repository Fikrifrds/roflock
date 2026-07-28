import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
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
  const dataDir = await mkdtemp(join(tmpdir(), 'rf-data-'));
  const repoDir = await mkdtemp(join(tmpdir(), 'rf-repo-'));
  execFileSync('git', ['init'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'RoleFlock'], { cwd: repoDir });
  await writeFile(join(repoDir, 'README.md'), '# fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });

  const session = { token: 'test-token', csrf: 'test-csrf' };
  const instance = await createServer({ dataDir, session });
  cleanup.push(async () => {
    await instance.app.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  });

  const headers = {
    'x-roleflock-token': session.token,
    'x-roleflock-csrf': session.csrf,
    'content-type': 'application/json',
  };

  return { app: instance.app, repoDir, headers };
}

async function waitFor(
  app: Awaited<ReturnType<typeof boot>>['app'],
  headers: Record<string, string>,
  path: string,
  predicate: (body: unknown) => boolean,
  timeoutMs = 10_000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await app.inject({ method: 'GET', url: path, headers });
    const body = response.json();
    if (predicate(body)) return body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

describe('verified bug fix walking skeleton', () => {
  it('runs parallel planners→reviewer confirmation→writer→test→verifier→accept', async () => {
    const { app, repoDir, headers } = await boot();
    const primaryBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    const project = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: { path: repoDir },
    });
    expect(project.statusCode).toBe(201);
    const projectBody = project.json() as { id: string };

    const task = await app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers,
      payload: {
        projectId: projectBody.id,
        type: 'bug_fix',
        title: 'Fix README typo',
        brief: 'README is incomplete',
        expectedBehaviour: 'Has fix note',
        actualBehaviour: 'Missing fix note',
      },
    });
    expect(task.statusCode).toBe(201);
    const taskBody = task.json() as { id: string };
    await authoriseTaskContract(app, headers, taskBody.id);

    const started = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskBody.id}/start`,
      headers,
      payload: {},
    });
    expect(started.statusCode).toBe(202);

    let approvals: Array<{ id: string }>;
    try {
      approvals = (await waitFor(
        app,
        headers,
        '/api/approvals',
        (body) => Array.isArray(body) && body.length > 0,
      )) as Array<{ id: string }>;
    } catch (reason) {
      const failedTask = await app.inject({
        method: 'GET',
        url: `/api/tasks/${taskBody.id}`,
        headers,
      });
      const failedEvidence = await app.inject({
        method: 'GET',
        url: `/api/evidence/tasks/${taskBody.id}`,
        headers,
      });
      throw new Error(
        `${String(reason)}; task=${failedTask.body}; evidence=${failedEvidence.body}`,
        { cause: reason },
      );
    }

    const planningGraph = (
      await app.inject({
        method: 'GET',
        url: `/api/tasks/${taskBody.id}/graph`,
        headers,
      })
    ).json() as {
      graph: {
        version: string;
        maxConcurrency: number;
        nodes: Array<{
          id: string;
          state: string;
          dependsOn: string[];
          focus: string | null;
          primaryProviderId: string | null;
          primaryModelId: string | null;
        }>;
      };
    };
    const graphNode = (id: string) =>
      planningGraph.graph.nodes.find((candidate) => candidate.id === id)!;
    expect(planningGraph.graph.version).toBe('bug_fix@3');
    expect(planningGraph.graph.maxConcurrency).toBe(2);
    expect(graphNode('planner').state).toBe('completed');
    expect(graphNode('planner_tests').state).toBe('completed');
    // The graph intentionally shows the configured primary model, not the
    // deterministic test adapter or a fallback used by an individual turn.
    expect(graphNode('planner').primaryProviderId).toBeTruthy();
    expect(graphNode('planner').primaryModelId).toBeTruthy();
    expect(graphNode('planner_tests').primaryProviderId).toBe(
      graphNode('planner').primaryProviderId,
    );
    expect(graphNode('planner_tests').primaryModelId).toBe(graphNode('planner').primaryModelId);
    expect(graphNode('planner').focus).not.toBe(graphNode('planner_tests').focus);
    expect(graphNode('reviewer').dependsOn).toEqual(['planner', 'planner_tests']);
    expect(graphNode('reviewer').state).toBe('running');
    expect(graphNode('reviewer').primaryProviderId).toBeTruthy();
    expect(graphNode('reviewer').primaryModelId).toBeTruthy();

    const approved = await app.inject({
      method: 'POST',
      url: `/api/approvals/${approvals[0]!.id}/approve`,
      headers,
      payload: {},
    });
    expect(approved.statusCode).toBe(200);

    await waitFor(
      app,
      headers,
      `/api/tasks/${taskBody.id}`,
      (body) => (body as { state: string }).state === 'awaiting_acceptance',
    );

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskBody.id}/accept`,
      headers,
      payload: {},
    });
    expect(accepted.statusCode).toBe(200);

    await waitFor(
      app,
      headers,
      `/api/tasks/${taskBody.id}`,
      (body) => (body as { state: string }).state === 'accepted',
    );

    const evidence = await app.inject({
      method: 'GET',
      url: `/api/evidence/tasks/${taskBody.id}`,
      headers,
    });
    expect(evidence.statusCode).toBe(200);
    const evidenceBody = evidence.json() as {
      artefacts: unknown[];
      testRuns: unknown[];
      findings: unknown[];
    };
    expect(evidenceBody.testRuns.length).toBeGreaterThan(0);
    expect(evidenceBody.artefacts.length).toBeGreaterThan(0);
    expect(evidenceBody.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          summary: expect.stringMatching(/^planner via /),
        }),
        expect.objectContaining({
          summary: expect.stringMatching(/^planner_tests via /),
        }),
        expect.objectContaining({
          severity: 'warning',
          summary: expect.stringMatching(/Simulation mode/i),
        }),
      ]),
    );
    expect(evidenceBody.testRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: 'simulation-check',
          stdout_ref: expect.stringMatching(/not a real repository test/i),
        }),
      ]),
    );

    const usage = await app.inject({
      method: 'GET',
      url: `/api/usage/tasks/${taskBody.id}`,
      headers,
    });
    expect(usage.statusCode).toBe(200);
    const usageBody = usage.json() as {
      scope: string;
      summary: { actualCostUsd: number; shadowCostUsd: number; entryCount: number };
      entries: unknown[];
    };
    expect(usageBody.scope).toBe('local-daemon');
    expect(usageBody.summary.entryCount).toBe(usageBody.entries.length);
    expect(usageBody.summary.actualCostUsd).toBe(0);
    // The deterministic stand-in reports no tokens, so there is nothing to
    // price. Showing a shadow cost here would be a number RoleFlock invented.
    expect(usageBody.summary.shadowCostUsd).toBe(0);
    expect(
      execFileSync('git', ['branch', '--show-current'], {
        cwd: repoDir,
        encoding: 'utf8',
      }).trim(),
    ).toBe(primaryBranch);
    expect(existsSync(join(repoDir, 'ROLEFLOCK_SIMULATION.md'))).toBe(false);
  }, 30_000);

  it('rejects non-local mutation origins', async () => {
    const { app, headers } = await boot();
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { ...headers, origin: 'https://evil.example' },
      payload: { path: '/tmp' },
    });
    expect(response.statusCode).toBe(403);
  });
});
