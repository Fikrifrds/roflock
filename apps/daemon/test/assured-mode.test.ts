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
  const dataDir = await mkdtemp(join(tmpdir(), 'rf-assured-data-'));
  const repoDir = await mkdtemp(join(tmpdir(), 'rf-assured-repo-'));
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

async function waitFor(
  app: FastifyInstance,
  headers: Record<string, string>,
  path: string,
  predicate: (body: unknown) => boolean,
  timeoutMs = 20_000,
) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < timeoutMs) {
    const response = await app.inject({ method: 'GET', url: path, headers });
    last = response.body;
    if (predicate(response.json())) return response.json();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${path}; last body was ${last}`);
}

async function createTask(
  app: FastifyInstance,
  headers: Record<string, string>,
  repoDir: string,
  mode: string,
) {
  const project = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers,
    payload: { path: repoDir },
  });
  expect(project.statusCode).toBe(201);
  const task = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers,
    payload: {
      projectId: (project.json() as { id: string }).id,
      type: 'chore',
      mode,
      title: 'Change that must be independently judged',
      brief: 'Produce a change that independent verification can judge.',
    },
  });
  expect(task.statusCode).toBe(201);
  const taskId = (task.json() as { id: string }).id;
  await authoriseTaskContract(app, headers, taskId);
  return taskId;
}

/** Supplies the approved plan and frozen specification an assured run needs. */
async function completeAssuranceChain(
  app: FastifyInstance,
  headers: Record<string, string>,
  taskId: string,
) {
  const actor = { ...headers, 'x-roleflock-actor-id': 'test-authority' };
  const planned = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/execution-plan`,
    headers: actor,
    payload: {
      summary: 'Write the simulation artefact and prove it with an independent check.',
      assumptions: [],
      steps: [
        {
          id: 'STEP-1',
          objective: 'Produce the change described by the contract.',
          criterionIds: ['AC-1'],
          allowedOperations: ['modify_file', 'run_command'],
          expectedFiles: ['ROLEFLOCK_SIMULATION.md'],
          completionEvidenceIds: ['E-1'],
        },
      ],
      allowedPaths: ['ROLEFLOCK_SIMULATION.md'],
      expectedChangedPaths: ['ROLEFLOCK_SIMULATION.md'],
      forbiddenPaths: ['.github'],
      dependencyChanges: [],
      migrationActions: [],
      verificationSpecId: 'verification_1',
      repairEnvelope: {
        allowedFailureClasses: ['formatting'],
        maxAttempts: 1,
        mayAddFiles: false,
        mayChangeDependencies: false,
        mayChangePublicApi: false,
        mayChangeSchema: false,
        pathScope: ['ROLEFLOCK_SIMULATION.md'],
      },
      changeBudget: {
        maxChangedFiles: 4,
        maxAddedLines: 200,
        maxDeletedLines: 100,
        maxNewDependencies: 0,
      },
      decisionLog: [],
    },
  });
  expect(planned.statusCode).toBe(201);
  const planId = (planned.json() as { plan: { id: string } }).plan.id;

  const approved = await app.inject({
    method: 'POST',
    url: `/api/execution-plans/${planId}/approve`,
    headers: { ...actor, 'if-match': '"1"' },
    payload: {},
  });
  expect(approved.statusCode).toBe(200);

  const specification = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/verification-specification`,
    headers: actor,
    payload: {
      checks: [
        {
          id: 'CHK-1',
          kind: 'command',
          criterionIds: ['AC-1'],
          required: true,
          description: 'Independent deterministic check for AC-1.',
          argv: ['node', '-e', 'process.exit(0)'],
          timeoutMs: 60_000,
          expectedExitCodes: [0],
        },
      ],
      environment: {
        platform: process.platform,
        architecture: process.arch,
        requiredTools: [{ name: 'node', versionConstraint: '>=24' }],
        network: 'deny',
        networkAllowlist: [],
        environmentVariableAllowlist: [],
        credentialProfileId: 'roleflock.verifier.local',
      },
      testMutationPolicy: 'forbid',
      minimumEvidence: [
        {
          id: 'REQ-1',
          criterionId: 'AC-1',
          evidenceType: 'command_result',
          minimumCount: 1,
          mandatory: true,
        },
      ],
    },
  });
  expect(specification.statusCode).toBe(201);
}

async function start(app: FastifyInstance, headers: Record<string, string>, taskId: string) {
  const started = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/start`,
    headers,
    payload: {},
  });
  expect(started.statusCode).toBe(202);
}

/**
 * Drives the run to a terminal state, clearing every confirmation it raises.
 *
 * A run without an approved plan asks for more than the reviewer gate — the
 * writer has no plan to derive its permitted paths from — so approving only the
 * first confirmation leaves the task parked rather than reaching the verdict
 * this test is about.
 */
async function settleWithApprovals(
  app: FastifyInstance,
  headers: Record<string, string>,
  taskId: string,
  terminal: string[],
  timeoutMs = 30_000,
) {
  const start = Date.now();
  let state = '';
  while (Date.now() - start < timeoutMs) {
    state = (
      (await app.inject({ method: 'GET', url: `/api/tasks/${taskId}`, headers })).json() as {
        state: string;
      }
    ).state;
    if (terminal.includes(state)) return state;
    const approvals = (
      await app.inject({ method: 'GET', url: '/api/approvals', headers })
    ).json() as Array<{ id: string }>;
    for (const approval of approvals) {
      await app.inject({
        method: 'POST',
        url: `/api/approvals/${approval.id}/approve`,
        headers,
        payload: {},
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Task ${taskId} never settled; last state was ${state}`);
}

describe('assured workflow mode', () => {
  it('refuses to verify without the assurance inputs instead of checking the writer worktree', async () => {
    const { app, repoDir, headers } = await boot();
    // Contract only: no approved plan and no frozen specification.
    const taskId = await createTask(app, headers, repoDir, 'assured');
    await start(app, headers, taskId);

    const state = await settleWithApprovals(app, headers, taskId, [
      'failed',
      'accepted',
      'awaiting_acceptance',
    ]);
    expect(state).toBe('failed');

    // The refusal has to name what is missing; "verification unavailable" gives
    // the user nothing to act on.
    const evidence = (
      await app.inject({ method: 'GET', url: `/api/evidence/tasks/${taskId}`, headers })
    ).json() as { findings: Array<{ details: string }> };
    const detail = evidence.findings.map((finding) => finding.details).join('\n');
    expect(detail).toMatch(/Assured mode cannot verify this task without/);
    expect(detail).toMatch(/approved Execution Plan/);

    // Nothing may present this run as verified.
    const passport = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/change-passport`,
      headers,
    });
    expect(passport.json()).toBeNull();
  }, 60_000);

  it('accepts the same incomplete task in an unassured mode, which is the difference', async () => {
    const { app, repoDir, headers } = await boot();
    // Identical inputs, only the mode differs: `direct` falls back to the
    // writer's own worktree check and reaches acceptance.
    const taskId = await createTask(app, headers, repoDir, 'direct');
    await start(app, headers, taskId);

    await waitFor(
      app,
      headers,
      `/api/tasks/${taskId}`,
      (body) => (body as { state: string }).state === 'awaiting_acceptance',
    );
    // And its verdict came from no independent verification at all.
    const verification = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/verification-result`,
      headers,
    });
    expect(verification.json()).toBeNull();
  }, 60_000);

  it('issues a passport when the assurance chain is complete', async () => {
    const { app, repoDir, headers } = await boot();
    const taskId = await createTask(app, headers, repoDir, 'assured');
    await completeAssuranceChain(app, headers, taskId);
    await start(app, headers, taskId);

    expect(await settleWithApprovals(app, headers, taskId, ['awaiting_acceptance', 'failed'])).toBe(
      'awaiting_acceptance',
    );
    const result = (
      await app.inject({
        method: 'GET',
        url: `/api/tasks/${taskId}/verification-result`,
        headers,
      })
    ).json() as { decision: { overallOutcome: string; subject: { resultCommit: string } } };
    expect(result.decision.overallOutcome).toBe('pass');

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/accept`,
      headers,
      payload: {},
    });
    expect(accepted.statusCode).toBe(200);

    const passportView = (await waitFor(
      app,
      headers,
      `/api/tasks/${taskId}/change-passport`,
      (body) => body !== null,
    )) as {
      passport: { verdict: string };
      payload: { subject: { resultCommit: string }; assurance: { verification: string } };
    };
    expect(passportView.passport.verdict).toBe('pass');
    expect(passportView.payload.assurance.verification).toBe('clean_local_runner');
    expect(passportView.payload.subject.resultCommit).toBe(result.decision.subject.resultCommit);
  }, 60_000);

  it('compiles the planner turn into a contract-bound plan proposal', async () => {
    const { app, repoDir, headers } = await boot();
    const taskId = await createTask(app, headers, repoDir, 'assured');
    await completeAssuranceChain(app, headers, taskId);
    await start(app, headers, taskId);
    await settleWithApprovals(app, headers, taskId, ['awaiting_acceptance', 'failed']);

    // `authorityRole: 'planner'` is what turns the planner's turn into a
    // versioned artefact bound to the authorised contract, rather than prose.
    const evidence = (
      await app.inject({ method: 'GET', url: `/api/evidence/tasks/${taskId}`, headers })
    ).json() as { artefacts: Array<{ kind: string; metadata_json: string | null }> };
    const proposal = evidence.artefacts.find((artefact) => artefact.kind === 'execution_plan')!;
    const metadata = JSON.parse(proposal.metadata_json ?? '{}') as {
      status: string;
      contractHash: string;
    };
    expect(metadata.status).toBe('proposed');
    expect(metadata.contractHash).toMatch(/^[a-f0-9]{64}$/);
  }, 60_000);
});
