import type { OutcomeObservation } from './outcomes.js';

export interface RolePerformanceAnalytics {
  evidenceKind: 'observational';
  sampleSize: number;
  accepted: { count: number; rate: number };
  firstPassVerification: { known: number; passed: number; rate?: number };
  executionAdherence: { known: number; mean?: number };
  deviationCount: { total: number; mean: number };
  interventionCount: { total: number; mean: number };
  latencyMs: { p50: number; p95: number; mean: number };
  actualCostUsd: { known: number; total?: number; mean?: number };
  confidence: number;
  caveats: string[];
}

export function calculateRolePerformance(
  observations: readonly OutcomeObservation[],
): RolePerformanceAnalytics {
  const included = observations.filter((observation) => !observation.excluded);
  if (included.length === 0) {
    return {
      evidenceKind: 'observational',
      sampleSize: 0,
      accepted: { count: 0, rate: 0 },
      firstPassVerification: { known: 0, passed: 0 },
      executionAdherence: { known: 0 },
      deviationCount: { total: 0, mean: 0 },
      interventionCount: { total: 0, mean: 0 },
      latencyMs: { p50: 0, p95: 0, mean: 0 },
      actualCostUsd: { known: 0 },
      confidence: 0,
      caveats: ['No compatible included observations are available.'],
    };
  }
  const accepted = included.filter(
    (observation) => observation.outcome.status === 'accepted',
  ).length;
  const verification = included
    .map((observation) => observation.outcome.verificationPassedFirstPass)
    .filter((value): value is boolean => value !== undefined);
  const adherence = included
    .map((observation) => observation.outcome.executionAdherence)
    .filter((value): value is number => value !== undefined);
  const costs = included
    .map((observation) => observation.outcome.actualCostUsd)
    .filter((value): value is number => value !== undefined);
  const deviations = included.map((observation) => observation.outcome.deviationCount);
  const interventions = included.map(
    (observation) => observation.outcome.interventionCount,
  );
  const latency = included
    .map((observation) => observation.outcome.latencyMs)
    .sort((left, right) => left - right);
  const caveats = [
    'Observed association only; task assignment was not a controlled experiment.',
  ];
  if (included.length < 5) caveats.push('Sample size is below the learning threshold of 5.');
  if (costs.length !== included.length) caveats.push('Cost is missing for some observations.');
  return {
    evidenceKind: 'observational',
    sampleSize: included.length,
    accepted: { count: accepted, rate: accepted / included.length },
    firstPassVerification: {
      known: verification.length,
      passed: verification.filter(Boolean).length,
      ...(verification.length
        ? { rate: verification.filter(Boolean).length / verification.length }
        : {}),
    },
    executionAdherence: {
      known: adherence.length,
      ...(adherence.length ? { mean: mean(adherence) } : {}),
    },
    deviationCount: { total: sum(deviations), mean: mean(deviations) },
    interventionCount: { total: sum(interventions), mean: mean(interventions) },
    latencyMs: {
      p50: percentile(latency, 0.5),
      p95: percentile(latency, 0.95),
      mean: mean(latency),
    },
    actualCostUsd: {
      known: costs.length,
      ...(costs.length ? { total: sum(costs), mean: mean(costs) } : {}),
    },
    confidence: Number(
      Math.min(1, included.length / 20, verification.length / included.length).toFixed(4),
    ),
    caveats,
  };
}

export function observedRecommendationSignal(
  analytics: RolePerformanceAnalytics,
  thresholds: { minimumSamples: number; minimumConfidence: number } = {
    minimumSamples: 5,
    minimumConfidence: 0.25,
  },
):
  | { eligible: false; reason: string }
  | { eligible: true; score: number; confidence: number; sampleSize: number } {
  if (analytics.sampleSize < thresholds.minimumSamples) {
    return {
      eligible: false,
      reason: `Requires ${thresholds.minimumSamples} compatible samples; found ${analytics.sampleSize}.`,
    };
  }
  if (analytics.confidence < thresholds.minimumConfidence) {
    return {
      eligible: false,
      reason: `Requires confidence ${thresholds.minimumConfidence}; found ${analytics.confidence}.`,
    };
  }
  const firstPass = analytics.firstPassVerification.rate ?? analytics.accepted.rate;
  return {
    eligible: true,
    score: Number(
      (
        analytics.accepted.rate * 0.55 +
        firstPass * 0.3 +
        (analytics.executionAdherence.mean ?? analytics.accepted.rate) * 0.15
      ).toFixed(6),
    ),
    confidence: analytics.confidence,
    sampleSize: analytics.sampleSize,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function mean(values: readonly number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.ceil(sorted.length * fraction) - 1]!;
}
