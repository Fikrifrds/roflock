import { describe, expect, it } from 'vitest';
import { sealOutcomeObservation, verifyOutcomeObservation } from './outcomes.js';

describe('outcome observations', () => {
  it('retains task, authority, routing, and profile versions immutably', () => {
    const observation = sealOutcomeObservation({
      schemaVersion: 1,
      observationId: 'observation_1',
      taskId: 'task_1',
      taskClass: {
        taskType: 'feature',
        risk: 'high',
        repositorySizeBucket: 'large',
        languageMix: ['typescript'],
        signals: ['database'],
      },
      roleAssignment: {
        roleId: 'executor',
        assignmentId: 'assignment_1',
        providerId: 'openai',
        modelId: 'gpt-5',
        modelFamily: 'gpt-5',
        profileVersion: '2026.07',
        routingPolicyVersion: 'routing-3',
        recommendationId: 'recommendation_1',
      },
      authority: {
        contractHash: '1'.repeat(64),
        planHash: '2'.repeat(64),
        resultCommit: '3'.repeat(40),
      },
      outcome: {
        status: 'accepted',
        verificationPassedFirstPass: true,
        executionAdherence: 1,
        deviationCount: 0,
        interventionCount: 1,
        latencyMs: 12_000,
        actualCostUsd: 0.42,
      },
      evidence: { passportId: 'passport_1', metricsDigest: '4'.repeat(64) },
      source: 'automatic',
      excluded: false,
      observedAt: '2026-07-28T12:00:00.000Z',
    });
    expect(verifyOutcomeObservation(observation)).toBe(true);
    expect(observation.roleAssignment.profileVersion).toBe('2026.07');
    expect(verifyOutcomeObservation({ ...observation, taskId: 'task_2' })).toBe(false);
  });
});
