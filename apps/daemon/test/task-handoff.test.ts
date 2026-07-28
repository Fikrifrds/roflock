import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorktreeRepository, openMigratedDatabase } from '@roleflock/database';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';
import { verifyTaskHandoffManifest, type TaskHandoff } from '../src/services/task-handoff.js';
import { authoriseTaskContract } from './contract-fixture.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) await cleanup();
  }
});

describe('task handoff', () => {
  it('pins task, contract, plan, branch, and workspace identity in every agent command', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'roleflock-handoff-data-'));
    const repositoryDir = await mkdtemp(join(tmpdir(), 'roleflock-handoff-repo-'));
    execFileSync('git', ['init'], { cwd: repositoryDir });
    execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], {
      cwd: repositoryDir,
    });
    execFileSync('git', ['config', 'user.name', 'RoleFlock Test'], {
      cwd: repositoryDir,
    });
    await writeFile(join(repositoryDir, 'README.md'), '# Handoff fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repositoryDir });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repositoryDir });
    const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repositoryDir,
      encoding: 'utf8',
    }).trim();
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
      'content-type': 'application/json',
    };
    const projectResponse = await server.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers,
      payload: { path: repositoryDir },
    });
    const project = projectResponse.json() as { id: string };
    const taskResponse = await server.app.inject({
      method: 'POST',
      url: '/api/tasks',
      headers,
      payload: {
        projectId: project.id,
        type: 'bug_fix',
        title: 'Pinned handoff',
        brief: 'Preserve authority identity.',
      },
    });
    const task = taskResponse.json() as { id: string };
    const contract = await authoriseTaskContract(server.app, headers, task.id);
    const proposed = await server.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/execution-plan`,
      headers,
      payload: proposal(),
    });
    const proposedPlan = proposed.json() as { plan: { id: string } };
    const approved = await server.app.inject({
      method: 'POST',
      url: `/api/execution-plans/${proposedPlan.plan.id}/approve`,
      headers: { ...headers, 'if-match': '"1"' },
      payload: {},
    });
    const approvedPlan = approved.json() as { plan: { id: string; hash: string } };
    const verification = await server.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/verification-specification`,
      headers,
      payload: verificationSpecificationBody(),
    });
    expect(verification.statusCode).toBe(201);
    const specification = verification.json() as {
      specification: { id: string; contractHash: string; planHash: string; hash: string };
    };
    expect(specification.specification).toMatchObject({
      id: 'verification_handoff',
      contractHash: contract.hash,
      planHash: approvedPlan.plan.hash,
    });
    expect(verification.headers.etag).toBe(`"${specification.specification.hash}"`);
    const mutation = await server.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/verification-specification`,
      headers,
      payload: {
        ...verificationSpecificationBody(),
        checks: [],
      },
    });
    expect(mutation.statusCode).toBe(409);
    expect(mutation.json()).toMatchObject({
      code: 'VERIFICATION_SPECIFICATION_FROZEN',
    });
    const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
    new WorktreeRepository(db).create({
      id: 'worktree_handoff',
      taskId: task.id,
      projectId: project.id,
      path: repositoryDir,
      branchName: `roleflock/${task.id}`,
      baseCommit,
      status: 'active',
      createdAt: '2026-07-28T10:00:00.000Z',
    });
    db.close();

    const response = await server.app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/handoff`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    const handoff = response.json() as TaskHandoff;
    expect(verifyTaskHandoffManifest(handoff.manifest)).toBe(true);
    expect(handoff.manifest).toMatchObject({
      task: { id: task.id, projectId: project.id },
      authority: {
        contractId: contract.id,
        contractHash: contract.hash,
        planId: approvedPlan.plan.id,
        planHash: approvedPlan.plan.hash,
      },
      workspace: {
        path: repositoryDir,
        branchName: `roleflock/${task.id}`,
        baseCommit,
      },
    });
    for (const command of handoff.commands.filter(({ id }) => id !== 'folder')) {
      expect(command.command).toContain(task.id);
      expect(command.command).toContain(contract.hash);
      expect(command.command).toContain(approvedPlan.plan.hash);
      expect(command.command).toContain(handoff.manifest.hash);
    }
  });
});

function proposal() {
  return {
    summary: 'Preserve the handoff identity.',
    assumptions: [],
    steps: [
      {
        id: 'STEP-1',
        objective: 'Update the requested source.',
        criterionIds: ['AC-1'],
        allowedOperations: ['modify_file', 'run_command'],
        expectedFiles: ['src/handoff.ts'],
        completionEvidenceIds: ['E-1'],
      },
    ],
    allowedPaths: ['src'],
    expectedChangedPaths: ['src/handoff.ts'],
    forbiddenPaths: ['infra'],
    dependencyChanges: [],
    migrationActions: [],
    verificationSpecId: 'verification_handoff',
    repairEnvelope: {
      allowedFailureClasses: [],
      maxAttempts: 0,
      mayAddFiles: false,
      mayChangeDependencies: false,
      mayChangePublicApi: false,
      mayChangeSchema: false,
      pathScope: ['src'],
    },
    changeBudget: {
      maxChangedFiles: 1,
      maxAddedLines: 50,
      maxDeletedLines: 50,
      maxNewDependencies: 0,
    },
    decisionLog: [],
  };
}

function verificationSpecificationBody() {
  return {
    checks: [
      {
        id: 'CHECK-1',
        criterionIds: ['AC-1'],
        required: true,
        description: 'Run exact handoff verification.',
        kind: 'command',
        argv: ['pnpm', 'test', '--', 'handoff'],
        timeoutMs: 120_000,
        expectedExitCodes: [0],
      },
    ],
    environment: {
      platform: 'linux',
      architecture: 'x64',
      requiredTools: [],
      network: 'deny',
      networkAllowlist: [],
      environmentVariableAllowlist: ['CI'],
      credentialProfileId: 'verifier-isolated',
    },
    testMutationPolicy: 'forbid',
    minimumEvidence: [
      {
        id: 'E-1',
        criterionId: 'AC-1',
        evidenceType: 'test_result',
        minimumCount: 1,
        mandatory: true,
      },
    ],
  };
}
