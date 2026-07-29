import { describe, expect, it } from 'vitest';
import {
  calculateRolePerformance,
  explainAdaptiveRouting,
  observedRecommendationSignal,
} from './analytics.js';
import type { OutcomeObservation } from './outcomes.js';

describe('role performance analytics', () => {
  it('reports inspectable quality, cost, latency, and intervention denominators', () => {
    const observations = [
      observation('accepted', true, 1000, 0.4),
      observation('rejected', false, 3000, undefined),
    ];
    expect(calculateRolePerformance(observations)).toMatchObject({
      evidenceKind: 'observational',
      sampleSize: 2,
      accepted: { count: 1, rate: 0.5 },
      firstPassVerification: { known: 2, passed: 1, rate: 0.5 },
      interventionCount: { total: 2, mean: 1 },
      latencyMs: { p50: 1000, p95: 3000, mean: 2000 },
      actualCostUsd: { known: 1, total: 0.4, mean: 0.4 },
    });
    expect(calculateRolePerformance(observations).caveats.join(' ')).toMatch(
      /not a controlled experiment/i,
    );
    expect(observedRecommendationSignal(calculateRolePerformance(observations))).toMatchObject({
      eligible: false,
    });
    const sufficient = calculateRolePerformance([
      ...observations,
      observation('accepted', true, 1100, 0.3),
      observation('accepted', true, 1200, 0.3),
      observation('accepted', true, 1300, 0.3),
    ]);
    expect(observedRecommendationSignal(sufficient)).toMatchObject({
      eligible: true,
      sampleSize: 5,
    });
    expect(
      explainAdaptiveRouting({
        analytics: sufficient,
        postMergePenalty: 0.25,
      }),
    ).toMatchObject({
      applied: true,
      factors: [
        { name: 'observed_success', contribution: expect.any(Number) },
        { name: 'post_merge_penalty', contribution: -0.25 },
        { name: 'user_control', contribution: 0 },
      ],
    });
    expect(
      explainAdaptiveRouting({
        analytics: sufficient,
        postMergePenalty: 0.25,
        control: 'frozen',
      }),
    ).toMatchObject({ applied: false, netAdjustment: 0 });
  });
});

function observation(
  status: OutcomeObservation['outcome']['status'],
  verificationPassedFirstPass: boolean,
  latencyMs: number,
  actualCostUsd: number | undefined,
): OutcomeObservation {
  return {
    schemaVersion: 1,
    observationId: `${status}_${latencyMs}`,
    taskId: 'task_1',
    taskClass: {
      taskType: 'feature',
      risk: 'medium',
      repositorySizeBucket: 'medium',
      languageMix: ['typescript'],
      signals: ['api'],
    },
    roleAssignment: {
      roleId: 'executor',
      assignmentId: 'assignment_1',
      providerId: 'provider_1',
      modelId: 'model_1',
      profileVersion: '1',
      routingPolicyVersion: '1',
    },
    authority: {
      contractHash: '1'.repeat(64),
      planHash: '2'.repeat(64),
      resultCommit: '3'.repeat(40),
    },
    outcome: {
      status,
      verificationPassedFirstPass,
      executionAdherence: status === 'accepted' ? 1 : 0.5,
      deviationCount: status === 'accepted' ? 0 : 1,
      interventionCount: 1,
      latencyMs,
      actualCostUsd,
    },
    evidence: { metricsDigest: '4'.repeat(64) },
    source: 'automatic',
    excluded: false,
    observedAt: '2026-07-28T12:00:00.000Z',
  };
}
