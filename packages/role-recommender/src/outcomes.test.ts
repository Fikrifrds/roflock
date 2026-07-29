import { describe, expect, it } from 'vitest';
import {
  normalizeTaskClass,
  postMergeFailurePenalty,
  sealPostMergeOutcome,
  sealOutcomeObservation,
  taskClassCompatibility,
  verifyOutcomeObservation,
} from './outcomes.js';

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

  it('does not pool materially incompatible task classes', () => {
    const feature = normalizeTaskClass({
      taskType: 'feature',
      risk: 'high',
      repositorySizeBucket: 'large',
      languageMix: ['TypeScript'],
      signals: ['database', 'auth'],
    });
    const similar = normalizeTaskClass({
      taskType: 'feature',
      risk: 'high',
      repositorySizeBucket: 'large',
      languageMix: ['typescript'],
      signals: ['auth', 'database'],
    });
    const cosmetic = normalizeTaskClass({
      taskType: 'cosmetic',
      risk: 'low',
      repositorySizeBucket: 'small',
      languageMix: ['css'],
      signals: ['ui'],
    });
    expect(taskClassCompatibility(feature, similar)).toMatchObject({
      compatible: true,
      score: 1,
    });
    expect(taskClassCompatibility(feature, cosmetic)).toMatchObject({
      compatible: false,
    });
    expect(
      normalizeTaskClass({
        taskType: 'feature',
        risk: 'medium',
        repositorySizeBucket: 'medium',
        languageMix: [],
        signals: [],
      }),
    ).toMatchObject({ confidence: 0.6, unknownDimensions: ['languageMix', 'signals'] });
  });

  it('records rollback and escaped-defect feedback without rewriting the observation', () => {
    const escaped = sealPostMergeOutcome({
      schemaVersion: 1,
      postMergeOutcomeId: 'post_merge_1',
      observationId: 'observation_1',
      taskId: 'task_1',
      passportId: 'passport_1',
      resultCommit: '3'.repeat(40),
      outcomeType: 'escaped_defect',
      severity: 'high',
      reportDigest: '5'.repeat(64),
      reportedBy: 'actor_1',
      detectedAt: '2026-07-29T12:00:00.000Z',
    });
    expect(postMergeFailurePenalty([escaped])).toMatchObject({
      penalty: 0.5,
      failures: 1,
    });
  });
});
