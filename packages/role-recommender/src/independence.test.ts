import { describe, expect, it } from 'vitest';
import {
  combineIndependenceRequirements,
  defaultIndependenceRequirements,
  evaluateRosterIndependence,
  validateFallbackIndependence,
  type ProposedRoleAssignment,
} from './index.js';

describe('role roster independence policy', () => {
  it('enforces critical executor/verifier provider and runner separation', () => {
    const requirements = defaultIndependenceRequirements('critical', [
      'planner',
      'executor',
      'verifier',
    ]);
    const decision = evaluateRosterIndependence(
      [
        assignment('planner', 'provider-a', 'planner-model', 'family-a', 'runner-a'),
        assignment('executor', 'provider-a', 'executor-model', 'family-b', 'runner-a'),
        assignment('verifier', 'provider-a', 'verifier-model', 'family-c', 'runner-a'),
      ],
      requirements,
    );
    expect(decision.eligible).toBe(false);
    expect(decision.requiredViolations.map((item) => item.requirement.property)).toEqual(
      expect.arrayContaining(['different_provider', 'different_runner']),
    );
  });

  it('rejects a fallback that collapses required separation', () => {
    const roster = [
      assignment('executor', 'provider-a', 'executor', 'family-a', 'runner-a'),
      assignment('verifier', 'provider-b', 'verifier', 'family-b', 'runner-b'),
    ];
    const requirements = defaultIndependenceRequirements('critical', ['executor', 'verifier']);
    expect(evaluateRosterIndependence(roster, requirements).eligible).toBe(true);

    const fallback = validateFallbackIndependence({
      roster,
      replacement: assignment('verifier', 'provider-a', 'fallback', 'family-c', 'runner-a'),
      requirements,
    });
    expect(fallback.eligible).toBe(false);
    expect(fallback.requiredViolations).toHaveLength(2);
  });

  it('fails closed when a required model family or runner identity is unknown', () => {
    const decision = evaluateRosterIndependence(
      [
        assignment('executor', 'provider-a', 'executor', undefined, 'runner-a'),
        assignment('verifier', 'provider-b', 'verifier', 'family-b', undefined),
      ],
      [
        {
          leftRole: 'executor',
          rightRole: 'verifier',
          property: 'different_model_family',
          level: 'required',
          source: 'task_policy',
        },
        {
          leftRole: 'executor',
          rightRole: 'verifier',
          property: 'different_runner',
          level: 'required',
          source: 'task_policy',
        },
      ],
    );
    expect(decision.eligible).toBe(false);
    expect(decision.requiredViolations.every((finding) => finding.known === false)).toBe(true);
  });

  it('does not allow organisation policy to weaken a required default', () => {
    const combined = combineIndependenceRequirements(
      [
        {
          leftRole: 'executor',
          rightRole: 'verifier',
          property: 'different_provider',
          level: 'required',
          source: 'risk_default',
        },
      ],
      [
        {
          leftRole: 'verifier',
          rightRole: 'executor',
          property: 'different_provider',
          level: 'preferred',
          source: 'organisation_policy',
        },
      ],
    );
    expect(combined).toHaveLength(1);
    expect(combined[0]?.level).toBe('required');
  });
});

function assignment(
  role: ProposedRoleAssignment['role'],
  providerId: string,
  modelId: string,
  modelFamily: string | undefined,
  runnerId: string | undefined,
): ProposedRoleAssignment {
  return {
    role,
    providerId,
    modelId,
    modelFamily,
    runnerId,
    invocationScope: 'dedicated',
  };
}
