import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssuranceSummary } from '../src/components/AssuranceSummary.js';
import type { Task } from '../src/types.js';
import { renderApp, stubApi } from './render.js';

const task: Task = {
  id: 't1',
  projectId: 'p1',
  title: 'Idempotent checkout',
  type: 'bug_fix',
  state: 'awaiting_acceptance',
  risk: 'high',
  brief: 'Prevent duplicate checkout submissions.',
  maxAttempts: 3,
  workflowGraphVersionId: 'bug_fix@3',
};

function stage(label: string) {
  return screen.getByText(label).closest('li')!;
}

describe('AssuranceSummary', () => {
  it('reports an unassured task as unproven instead of leaving the gap silent', async () => {
    stubApi({
      '/api/tasks/t1/change-contract': null,
      '/api/tasks/t1/execution-plan': null,
      '/api/tasks/t1/verification-result': null,
      '/api/tasks/t1/change-passport': null,
    });
    renderApp(<AssuranceSummary task={task} />);

    await waitFor(() => {
      expect(stage('Intent')).toHaveTextContent('Not established');
    });
    expect(stage('Plan')).toHaveTextContent('Not established');
    // The critical one: no independent evidence must never read as neutral.
    expect(stage('Verification')).toHaveTextContent('Executor claim only');
    expect(stage('Verification')).toHaveTextContent('Self-reported tests are not evidence');
    expect(stage('Passport')).toHaveTextContent('Not issued');
    expect(screen.getByText('This change is not fully assured yet.')).toBeInTheDocument();
  });

  it('confirms the full chain only when every stage is proven', async () => {
    stubApi({
      '/api/tasks/t1/change-contract': {
        contract: { status: 'authorised', version: 2, acceptanceCriteria: [{ id: 'AC-1' }] },
      },
      '/api/tasks/t1/execution-plan': {
        plan: { status: 'approved', version: 3, steps: [{ id: 'STEP-1' }] },
        deviations: [],
      },
      '/api/tasks/t1/verification-result': {
        decision: {
          overallOutcome: 'pass',
          verdicts: [{ criterionId: 'AC-1', outcome: 'pass' }],
        },
        attestations: [{ id: 'attestation_1' }],
      },
      '/api/tasks/t1/change-passport': {
        passport: { passportId: 'passport_1' },
        reviewPacket: {
          verdict: 'pass',
          assurance: { issuerTrustLabel: 'Local self-attestation' },
        },
      },
    });
    renderApp(<AssuranceSummary task={task} />);

    await waitFor(() => {
      expect(stage('Intent')).toHaveTextContent('Authorised');
    });
    expect(stage('Plan')).toHaveTextContent('v3 · 1 step(s), no open deviations');
    expect(stage('Verification')).toHaveTextContent('1/1 criteria passed on clean-runner evidence');
    // The passport reports the trust level, never a bare "signed".
    expect(stage('Passport')).toHaveTextContent('Local self-attestation');
    expect(
      screen.getByText('Authorised, planned, independently verified, and signed.'),
    ).toBeInTheDocument();
  });

  it('keeps an open deviation and a revoked passport visible', async () => {
    stubApi({
      '/api/tasks/t1/change-contract': {
        contract: { status: 'authorised', version: 1, acceptanceCriteria: [{ id: 'AC-1' }] },
      },
      '/api/tasks/t1/execution-plan': {
        plan: { status: 'approved', version: 1, steps: [{ id: 'STEP-1' }] },
        deviations: [{ id: 'dev_1', status: 'open' }],
      },
      '/api/tasks/t1/verification-result': {
        decision: {
          overallOutcome: 'fail',
          verdicts: [{ criterionId: 'AC-1', outcome: 'fail' }],
        },
        attestations: [],
      },
      '/api/tasks/t1/change-passport': {
        passport: { passportId: 'passport_1' },
        revocation: { reason: 'Superseded by a later change', revokedAt: '2026-07-29T00:00:00Z' },
        reviewPacket: { verdict: 'pass', assurance: { issuerTrustLabel: 'Local self' } },
      },
    });
    renderApp(<AssuranceSummary task={task} />);

    await waitFor(() => {
      expect(stage('Plan')).toHaveTextContent('1 open deviation(s)');
    });
    expect(stage('Verification')).toHaveTextContent('Failed');
    // A revoked passport must not keep presenting its original PASS verdict.
    expect(stage('Passport')).toHaveTextContent('Revoked');
    expect(stage('Passport')).toHaveTextContent('Superseded by a later change');
  });
});
