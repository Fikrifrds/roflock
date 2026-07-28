import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  sealVerificationSpecification,
  type UnhashedVerificationSpecification,
} from '@roleflock/verification-runner';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase } from './client.js';
import { VerificationSpecificationRepository } from './repositories/verification-specification-repository.js';

const directories: string[] = [];
afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function input(): UnhashedVerificationSpecification {
  return {
    id: 'verification_1',
    taskId: 'task_1',
    contractHash: 'a'.repeat(64),
    planId: 'plan_1',
    planHash: 'b'.repeat(64),
    version: 1,
    status: 'approved',
    checks: [
      {
        id: 'CHECK-1',
        criterionIds: ['AC-1'],
        required: true,
        description: 'Run exact tests.',
        kind: 'command',
        argv: ['pnpm', 'test'],
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
    authoredBy: { actorId: 'test-planner', actorType: 'service' },
    approvedBy: { actorId: 'authority', actorType: 'human' },
    approvedAt: '2026-07-28T10:00:00.000Z',
  };
}

describe('VerificationSpecificationRepository', () => {
  it('persists one immutable, hash-verified specification per task', () => {
    const directory = mkdtempSync(join(tmpdir(), 'roleflock-verification-spec-'));
    directories.push(directory);
    const db = openMigratedDatabase(join(directory, 'test.db'));
    const repository = new VerificationSpecificationRepository(db);
    const specification = sealVerificationSpecification(input());

    repository.create(specification, '2026-07-28T10:00:00.000Z');
    expect(repository.getByTask('task_1')).toEqual(specification);
    expect(() =>
      db
        .prepare(`UPDATE verification_specifications SET artifact_json = '{}' WHERE id = ?`)
        .run(specification.id),
    ).toThrow(/immutable/);
    expect(() =>
      repository.create(sealVerificationSpecification({ ...input(), id: 'verification_other' })),
    ).toThrow();
  });
});
