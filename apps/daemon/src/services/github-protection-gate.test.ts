import { describe, expect, it } from 'vitest';
import { evaluateGitHubProtectionGate } from './github-protection-gate.js';

const check = {
  id: 'check_1',
  githubRepositoryMappingId: 'repository_1',
  taskId: 'task_1',
  commitSha: 'a'.repeat(40),
  passportId: 'passport_1',
  passportPayloadDigest: 'b'.repeat(64),
  conclusion: 'success' as const,
  summary: 'PASS',
  createdAt: '2026-07-28T12:00:00.000Z',
};

describe('GitHub required RoleFlock check', () => {
  it('allows only a successful exact-commit check with a live passport', () => {
    expect(
      evaluateGitHubProtectionGate({
        status: { state: 'current', check },
        passportRevoked: false,
      }),
    ).toEqual({
      allowed: true,
      code: 'ROLEFLOCK_CHECK_CURRENT',
      checkId: 'check_1',
      passportId: 'passport_1',
    });
  });

  it('blocks a new commit that only has a prior PASS', () => {
    expect(
      evaluateGitHubProtectionGate({
        status: { state: 'missing', invalidatedCheck: check },
        passportRevoked: false,
      }),
    ).toMatchObject({
      allowed: false,
      code: 'ROLEFLOCK_CHECK_MISSING',
      invalidatedCheckId: 'check_1',
    });
  });

  it('blocks a revoked passport even when the old check said success', () => {
    expect(
      evaluateGitHubProtectionGate({
        status: { state: 'current', check },
        passportRevoked: true,
      }),
    ).toMatchObject({ allowed: false, code: 'ROLEFLOCK_PASSPORT_REVOKED' });
  });
});
