import type { CommitStatusDecision } from '@roleflock/database';

export type GitHubProtectionGateDecision =
  | {
      allowed: true;
      code: 'ROLEFLOCK_CHECK_CURRENT';
      checkId: string;
      passportId: string;
    }
  | {
      allowed: false;
      code:
        | 'ROLEFLOCK_CHECK_MISSING'
        | 'ROLEFLOCK_CHECK_FAILED'
        | 'ROLEFLOCK_PASSPORT_MISSING'
        | 'ROLEFLOCK_PASSPORT_REVOKED';
      reason: string;
      invalidatedCheckId?: string;
    };

export function evaluateGitHubProtectionGate(input: {
  status: CommitStatusDecision;
  passportRevoked: boolean;
}): GitHubProtectionGateDecision {
  if (input.status.state === 'missing') {
    return {
      allowed: false,
      code: 'ROLEFLOCK_CHECK_MISSING',
      reason: 'No RoleFlock check exists for the exact candidate commit.',
      invalidatedCheckId: input.status.invalidatedCheck?.id,
    };
  }
  if (input.status.check.conclusion !== 'success') {
    return {
      allowed: false,
      code: 'ROLEFLOCK_CHECK_FAILED',
      reason: `RoleFlock check concluded ${input.status.check.conclusion}.`,
    };
  }
  if (!input.status.check.passportId) {
    return {
      allowed: false,
      code: 'ROLEFLOCK_PASSPORT_MISSING',
      reason: 'Successful check has no bound Change Passport.',
    };
  }
  if (input.passportRevoked) {
    return {
      allowed: false,
      code: 'ROLEFLOCK_PASSPORT_REVOKED',
      reason: 'The Change Passport bound to this check has been revoked.',
    };
  }
  return {
    allowed: true,
    code: 'ROLEFLOCK_CHECK_CURRENT',
    checkId: input.status.check.id,
    passportId: input.status.check.passportId,
  };
}
