import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ChangeContractPanel } from '../src/components/ChangeContractPanel.js';
import type { ChangeContract, ChangeContractResponse, Task } from '../src/types.js';
import { renderApp, stubApi } from './render.js';

const task: Task = {
  id: 't1',
  projectId: 'p1',
  title: 'Idempotent checkout',
  type: 'bug_fix',
  state: 'ready',
  risk: 'high',
  brief: 'Prevent duplicate checkout submissions.',
  expectedBehaviour: 'A repeated request creates exactly one order.',
  maxAttempts: 3,
  workflowGraphVersionId: 'bug_fix@2',
};

function contract(status: ChangeContract['status']): ChangeContract {
  return {
    id: 'contract_1',
    taskId: task.id,
    projectId: 'p1',
    repositoryId: 'p1',
    version: 1,
    status,
    objective: 'Prevent duplicate checkout submissions.',
    acceptanceCriteria: [
      {
        id: 'AC-1',
        statement: 'A repeated request creates exactly one order.',
        verificationType: 'automated_test',
        requiredEvidenceIds: ['E-1'],
      },
    ],
    prohibitedOutcomes: [
      {
        id: 'PO-1',
        statement: 'Do not change payment-provider semantics.',
        severity: 'critical',
      },
    ],
    outOfScope: ['Checkout redesign'],
    risk: 'high',
    requiredEvidence: [
      {
        id: 'E-1',
        type: 'test_result',
        description: 'Checkout idempotency integration test.',
        mandatory: true,
      },
    ],
    authoritySources: [
      {
        id: 'SRC-1',
        kind: 'user_input',
        locator: 'task://t1/brief',
        digest: 'a'.repeat(64),
      },
    ],
    unresolvedQuestions: [],
    draftedBy: 'planner_1',
    authorisedBy: status === 'authorised' ? 'user_fikri' : undefined,
    authorisedAt: status === 'authorised' ? '2026-07-28T08:00:00.000Z' : undefined,
    createdAt: '2026-07-28T07:00:00.000Z',
    hashAlgorithm: 'sha256',
    hash: 'b'.repeat(64),
  };
}

function response(value: ChangeContract): ChangeContractResponse {
  return {
    aggregate: {
      id: value.id,
      taskId: value.taskId,
      projectId: value.projectId,
      repositoryId: value.repositoryId,
      currentContractVersion: value.version,
      currentVersionId: `${value.id}:v${value.version}`,
      currentHash: value.hash,
      status: value.status,
      revision: 3,
      createdAt: value.createdAt,
      updatedAt: value.createdAt,
    },
    contract: value,
  };
}

describe('ChangeContractPanel', () => {
  it('presents an authorised contract as a sealed authority record', async () => {
    const value = contract('authorised');
    stubApi({
      '/api/tasks/t1/change-contract': response(value),
      '/api/change-contracts/contract_1/versions': {
        aggregate: response(value).aggregate,
        versions: [{ versionId: 'contract_1:v1', contract: value }],
      },
    });

    renderApp(<ChangeContractPanel task={task} />);

    expect(await screen.findByText('authorised')).toBeInTheDocument();
    expect(screen.getByText('Prevent duplicate checkout submissions.')).toBeInTheDocument();
    expect(screen.getByText('A repeated request creates exactly one order.')).toBeInTheDocument();
    expect(screen.getByText(/Authorised by user_fikri/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create revision' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Authorise contract' })).not.toBeInTheDocument();
  });

  it('sends authorisation with idempotency and the current revision', async () => {
    const value = contract('awaiting_authorisation');
    const fetchMock = stubApi({
      '/api/tasks/t1/change-contract': response(value),
      '/api/change-contracts/contract_1/versions': {
        aggregate: response(value).aggregate,
        versions: [{ versionId: 'contract_1:v1', contract: value }],
      },
      '/api/change-contracts/contract_1/authorise': response({
        ...value,
        status: 'authorised',
      }),
    });

    renderApp(<ChangeContractPanel task={task} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Authorise contract' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([path]) => path === '/api/change-contracts/contract_1/authorise',
      );
      expect(call).toBeDefined();
      const init = call?.[1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        'if-match': '"3"',
        'x-roleflock-actor-id': 'local-user',
      });
      expect((init.headers as Record<string, string>)['idempotency-key']).toBeTruthy();
    });
  });

  it('lets authority resolve a blocking clarification before saving', async () => {
    const value = contract('needs_clarification');
    value.unresolvedQuestions = [
      {
        id: 'Q-1',
        question: 'Which response must be replayed?',
        blocking: true,
        status: 'open',
      },
    ];
    const fetchMock = stubApi({
      '/api/tasks/t1/change-contract': response(value),
      '/api/change-contracts/contract_1/versions': {
        aggregate: response(value).aggregate,
        versions: [{ versionId: 'contract_1:v1', contract: value }],
      },
      '/api/change-contracts/contract_1/draft': response(value),
    });

    renderApp(<ChangeContractPanel task={task} />);
    const answer = await screen.findByRole('textbox', { name: 'Answer Q-1' });
    await userEvent.type(answer, 'Replay the first successful response.');
    await userEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save contract' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([path]) => path === '/api/change-contracts/contract_1/draft',
      );
      expect(call).toBeDefined();
      const body = JSON.parse(String((call?.[1] as RequestInit).body)) as {
        unresolvedQuestions: Array<{ status: string; resolution: string }>;
      };
      expect(body.unresolvedQuestions[0]).toMatchObject({
        status: 'resolved',
        resolution: 'Replay the first successful response.',
      });
    });
  });
});
