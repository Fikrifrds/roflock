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

async function boot(existing?: { dataDir: string; repoDir: string }) {
  const dataDir = existing?.dataDir ?? (await mkdtemp(join(tmpdir(), 'rf-assure-data-')));
  const repoDir = existing?.repoDir ?? (await mkdtemp(join(tmpdir(), 'rf-assure-repo-')));
  if (existing) return restart(dataDir, repoDir);
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
    dataDir,
    repoDir,
    headers: {
      'x-roleflock-token': session.token,
      'x-roleflock-csrf': session.csrf,
      'content-type': 'application/json',
    },
  };
}

/** Boots a second daemon over the same data directory, as a restart would. */
async function restart(dataDir: string, repoDir: string) {
  const session = { token: 'test-token', csrf: 'test-csrf' };
  const instance = await createServer({ dataDir, session });
  cleanup.push(async () => {
    await instance.app.close();
  });
  return {
    app: instance.app,
    dataDir,
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

/**
 * Drives a task all the way to an authorised contract, an approved plan, and a
 * frozen verification specification — the three inputs that switch the run onto
 * the assurance path.
 */
async function assuredTask(
  app: FastifyInstance,
  headers: Record<string, string>,
  repoDir: string,
  checkArgv: string[],
) {
  const project = await app.inject({
    method: 'POST',
    url: '/api/projects',
    headers,
    payload: { path: repoDir },
  });
  expect(project.statusCode).toBe(201);
  const projectId = (project.json() as { id: string }).id;

  const task = await app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers,
    payload: {
      projectId,
      type: 'chore',
      mode: 'direct',
      title: 'Seal an assured change',
      brief: 'Produce a change that independent verification can judge.',
    },
  });
  expect(task.statusCode).toBe(201);
  const taskId = (task.json() as { id: string }).id;
  const contract = await authoriseTaskContract(app, headers, taskId);

  const planned = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/execution-plan`,
    headers: { ...headers, 'x-roleflock-actor-id': 'test-authority' },
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
  const plan = (planned.json() as { plan: { id: string }; aggregate: { revision: number } }).plan;

  const approved = await app.inject({
    method: 'POST',
    url: `/api/execution-plans/${plan.id}/approve`,
    headers: { ...headers, 'if-match': '"1"', 'x-roleflock-actor-id': 'test-authority' },
    payload: {},
  });
  expect(approved.statusCode).toBe(200);

  const specification = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/verification-specification`,
    headers: { ...headers, 'x-roleflock-actor-id': 'test-authority' },
    payload: {
      checks: [
        {
          id: 'CHK-1',
          kind: 'command',
          criterionIds: ['AC-1'],
          required: true,
          description: 'Independent deterministic check for AC-1.',
          argv: checkArgv,
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
        // Deliberately not the writer profile: the deterministic runner refuses
        // to run a verifier that shares the writer's credentials.
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

  const started = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/start`,
    headers,
    payload: {},
  });
  expect(started.statusCode).toBe(202);
  return { taskId, contractHash: contract.hash, planId: plan.id };
}

describe('assured delivery pipeline', () => {
  it('verifies a sealed commit in a clean runner and issues a signed passport on acceptance', async () => {
    const { app, repoDir, headers } = await boot();
    const primaryBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();
    const { taskId } = await assuredTask(app, headers, repoDir, ['node', '-e', 'process.exit(0)']);

    await waitFor(
      app,
      headers,
      `/api/tasks/${taskId}`,
      (body) => (body as { state: string }).state === 'awaiting_acceptance',
    );

    // The verification decision exists before any human decides, and it came
    // from attestations rather than from anything the writer reported.
    const verification = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/verification-result`,
      headers,
    });
    expect(verification.statusCode).toBe(200);
    const result = verification.json() as {
      decision: {
        overallOutcome: string;
        verdicts: Array<{ criterionId: string; outcome: string; evidenceRefs: string[] }>;
        subject: { resultCommit: string; baseCommit: string };
        attestationHashes: string[];
      };
      attestations: Array<{
        outcome: string;
        runnerIdentity: { trustLevel: string };
        subject: { resultCommit: string };
      }>;
    };
    expect(result.decision.overallOutcome).toBe('pass');
    expect(result.decision.verdicts).toEqual([
      expect.objectContaining({ criterionId: 'AC-1', outcome: 'pass' }),
    ]);
    expect(result.attestations).toHaveLength(1);
    expect(result.attestations[0]!.runnerIdentity.trustLevel).toBe('clean_local_runner');
    // The attestation names the sealed commit, not a dirty writer filesystem.
    expect(result.attestations[0]!.subject.resultCommit).toBe(result.decision.subject.resultCommit);
    expect(result.decision.verdicts[0]!.evidenceRefs).toHaveLength(1);

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/accept`,
      headers,
      payload: {},
    });
    expect(accepted.statusCode).toBe(200);
    await waitFor(
      app,
      headers,
      `/api/tasks/${taskId}`,
      (body) => (body as { state: string }).state === 'accepted',
    );

    const passportView = (await waitFor(
      app,
      headers,
      `/api/tasks/${taskId}/change-passport`,
      (body) => body !== null,
    )) as {
      passport: { passportId: string; verdict: string; resultCommit: string };
      payload: {
        verdict: string;
        subject: { resultCommit: string; baseCommit: string };
        assurance: { verification: string; issuerTrust: string };
        verificationAttestations: unknown[];
        unresolvedRisks: Array<{ id: string; blocking: boolean }>;
      };
      identity: { kind: string };
      reviewPacket: { caveats: string[] };
    };
    expect(passportView.passport.verdict).toBe('pass');
    expect(passportView.payload.subject.resultCommit).toBe(result.decision.subject.resultCommit);
    expect(passportView.payload.assurance.verification).toBe('clean_local_runner');
    expect(passportView.payload.assurance.issuerTrust).toBe('local_self');
    expect(passportView.identity.kind).toBe('local_installation');
    expect(passportView.payload.verificationAttestations).toHaveLength(1);
    // Network isolation could not be enforced on this host, so the passport
    // says so instead of quietly claiming an isolated runner.
    expect(passportView.payload.unresolvedRisks).toEqual([
      expect.objectContaining({ id: 'risk_network_isolation_unenforced', blocking: false }),
    ]);

    const verified = await app.inject({
      method: 'POST',
      url: `/api/change-passports/${passportView.passport.passportId}/verify`,
      headers,
      payload: {},
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toEqual(
      expect.objectContaining({
        cryptographicValidity: 'valid',
        identityStatus: 'trusted',
        subjectStatus: 'match',
        revocationStatus: 'current',
        accepted: true,
      }),
    );

    const revoked = await app.inject({
      method: 'POST',
      url: `/api/change-passports/${passportView.passport.passportId}/revoke`,
      headers,
      payload: { reason: 'Superseded by a later change' },
    });
    expect(revoked.statusCode).toBe(200);
    const afterRevocation = await app.inject({
      method: 'POST',
      url: `/api/change-passports/${passportView.passport.passportId}/verify`,
      headers,
      payload: {},
    });
    expect(afterRevocation.json()).toEqual(
      expect.objectContaining({ revocationStatus: 'revoked', accepted: false }),
    );

    // Sealing the verification subject must not move the user's branch or
    // touch the primary checkout.
    expect(
      execFileSync('git', ['branch', '--show-current'], { cwd: repoDir, encoding: 'utf8' }).trim(),
    ).toBe(primaryBranch);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: repoDir, encoding: 'utf8' })).toBe(
      '',
    );
  }, 60_000);

  it('still issues a passport when the daemon restarts before the human accepts', async () => {
    const first = await boot();
    const { taskId } = await assuredTask(first.app, first.headers, first.repoDir, [
      'node',
      '-e',
      'process.exit(0)',
    ]);
    await waitFor(
      first.app,
      first.headers,
      `/api/tasks/${taskId}`,
      (body) => (body as { state: string }).state === 'awaiting_acceptance',
    );
    const verifiedCommit = (
      (await waitFor(
        first.app,
        first.headers,
        `/api/tasks/${taskId}/verification-result`,
        (body) => body !== null,
      )) as { decision: { subject: { resultCommit: string } } }
    ).decision.subject.resultCommit;
    await first.app.close();

    // The reviewer's decision arrives against a daemon that never held the
    // in-memory handoff from the verification run.
    const second = await boot({ dataDir: first.dataDir, repoDir: first.repoDir });
    const accepted = await second.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/accept`,
      headers: second.headers,
      payload: {},
    });
    expect(accepted.statusCode).toBe(200);

    const passportView = (await waitFor(
      second.app,
      second.headers,
      `/api/tasks/${taskId}/change-passport`,
      (body) => body !== null,
    )) as { passport: { verdict: string }; payload: { subject: { resultCommit: string } } };
    expect(passportView.passport.verdict).toBe('pass');
    // Rebuilt from durable evidence, so it must name the same verified commit.
    expect(passportView.payload.subject.resultCommit).toBe(verifiedCommit);
  }, 60_000);

  it('does not let an executor reach acceptance when the independent check fails', async () => {
    const { app, repoDir, headers } = await boot();
    const { taskId } = await assuredTask(app, headers, repoDir, ['node', '-e', 'process.exit(1)']);

    await waitFor(app, headers, `/api/tasks/${taskId}`, (body) =>
      ['failed', 'accepted'].includes((body as { state: string }).state),
    );
    const task = (
      await app.inject({ method: 'GET', url: `/api/tasks/${taskId}`, headers })
    ).json() as { state: string };
    expect(task.state).toBe('failed');

    const verification = (
      await app.inject({
        method: 'GET',
        url: `/api/tasks/${taskId}/verification-result`,
        headers,
      })
    ).json() as { decision: { overallOutcome: string; findings: Array<{ routedTo: string }> } };
    expect(verification.decision.overallOutcome).toBe('fail');
    // A verifier finding is planner work, never a patch instruction back to the
    // executor.
    expect(verification.decision.findings.every((finding) => finding.routedTo === 'planner')).toBe(
      true,
    );

    // No passport may exist for a run whose evidence failed.
    const passport = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/change-passport`,
      headers,
    });
    expect(passport.json()).toBeNull();
  }, 60_000);
});
