import { describe, expect, it } from 'vitest';
import {
  ROLE_AUTHORITY_MATRIX,
  ROLE_IDS,
  RoleProtocolViolation,
  assertRoleAction,
  assertRoleCompletion,
  assertRoleStart,
  validateAuthorityMatrix,
  type ArtifactKind,
  type PresentedArtifact,
} from './index.js';

const artifact = (
  kind: ArtifactKind,
  status?: string,
  overrides: Partial<PresentedArtifact> = {},
): PresentedArtifact => ({
  id: `${kind}_1`,
  kind,
  status,
  hash: 'a'.repeat(64),
  valid: true,
  current: true,
  ...overrides,
});

describe('role authority protocol', () => {
  it('defines one internally consistent contract for every core role', () => {
    expect(() => validateAuthorityMatrix()).not.toThrow();
    expect(Object.keys(ROLE_AUTHORITY_MATRIX).sort()).toEqual([...ROLE_IDS].sort());
  });

  it('rejects planning and acceptance actions from the executor', () => {
    for (const action of ['plan_publish', 'plan_revise', 'acceptance_decide'] as const) {
      expect(() => assertRoleAction('executor', action)).toThrow(RoleProtocolViolation);
    }
    expect(() => assertRoleAction('executor', 'execute_plan_step')).not.toThrow();
  });

  it('rejects source writes by planner, critic, test runner, and verifier', () => {
    for (const role of ['planner', 'plan_critic', 'test_runner', 'verifier'] as const) {
      expect(() => assertRoleAction(role, 'repository_write')).toThrow(
        expect.objectContaining({ code: 'ACTION_FORBIDDEN' }),
      );
    }
  });

  it('requires the executor to start from current authorised and approved hashes', () => {
    const validInputs = [
      artifact('change_contract', 'authorised'),
      artifact('execution_plan', 'approved'),
      artifact('verification_specification', 'approved'),
    ];
    expect(() => assertRoleStart('executor', validInputs)).not.toThrow();

    expect(() =>
      assertRoleStart('executor', [
        ...validInputs.slice(0, 1),
        artifact('execution_plan', 'proposed'),
        validInputs[2]!,
      ]),
    ).toThrow(expect.objectContaining({ code: 'REQUIRED_INPUT_INVALID' }));
    expect(() =>
      assertRoleStart('executor', [
        validInputs[0]!,
        artifact('execution_plan', 'approved', { current: false }),
        validInputs[2]!,
      ]),
    ).toThrow(expect.objectContaining({ code: 'REQUIRED_INPUT_INVALID' }));
  });

  it('never lets raw stakeholder feedback enter executor context', () => {
    expect(() =>
      assertRoleStart('executor', [
        artifact('change_contract', 'authorised'),
        artifact('execution_plan', 'approved'),
        artifact('verification_specification', 'approved'),
        artifact('feedback_item', 'received'),
      ]),
    ).toThrow(/cannot consume raw stakeholder feedback/);
  });

  it('rejects verifier direction to an executor and routes escalation to planner', () => {
    expect(() => assertRoleAction('verifier', 'direct_executor')).toThrow(
      expect.objectContaining({ code: 'ACTION_FORBIDDEN' }),
    );
    expect(ROLE_AUTHORITY_MATRIX.verifier.escalationTargets).toContain('planner');
  });

  it('requires schema-valid current outputs at role completion', () => {
    expect(() =>
      assertRoleCompletion('planner', [artifact('execution_plan', 'proposed')]),
    ).not.toThrow();
    expect(() =>
      assertRoleCompletion('planner', [
        artifact('execution_plan', 'proposed', { hash: undefined }),
      ]),
    ).toThrow(expect.objectContaining({ code: 'REQUIRED_OUTPUT_INVALID' }));
  });
});
