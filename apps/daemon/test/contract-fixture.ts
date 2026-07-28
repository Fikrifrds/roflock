import type { FastifyInstance } from 'fastify';

export async function authoriseTaskContract(
  app: FastifyInstance,
  headers: Record<string, string>,
  taskId: string,
): Promise<{ id: string; hash: string }> {
  const actorHeaders = {
    ...headers,
    'x-roleflock-actor-id': 'test-authority',
  };
  const created = await app.inject({
    method: 'POST',
    url: `/api/tasks/${taskId}/change-contract`,
    headers: {
      ...actorHeaders,
      'idempotency-key': `create-contract-${taskId}`,
    },
    payload: {
      objective: 'Complete the task exactly as described by its authoritative brief.',
      acceptanceCriteria: [
        {
          id: 'AC-1',
          statement: 'The requested task outcome is implemented and verified.',
          verificationType: 'automated_test',
          requiredEvidenceIds: ['E-1'],
        },
      ],
      prohibitedOutcomes: [
        {
          id: 'PO-1',
          statement: 'Do not make unrelated changes.',
          severity: 'critical',
        },
      ],
      outOfScope: ['Unrelated repository changes'],
      requiredEvidence: [
        {
          id: 'E-1',
          type: 'test_result',
          description: 'The configured verification command passes.',
          mandatory: true,
        },
      ],
      authoritySources: [
        {
          id: 'SRC-1',
          kind: 'user_input',
          locator: `task://${taskId}/brief`,
          digest: 'a'.repeat(64),
        },
      ],
      unresolvedQuestions: [],
    },
  });
  if (created.statusCode !== 201) {
    throw new Error(`Failed to create test contract: ${created.body}`);
  }
  const contract = (created.json() as { contract: { id: string; hash: string } }).contract;

  const requested = await app.inject({
    method: 'POST',
    url: `/api/change-contracts/${contract.id}/authorisation-request`,
    headers: {
      ...actorHeaders,
      'idempotency-key': `request-contract-${taskId}`,
      'if-match': '"1"',
    },
    payload: {},
  });
  if (requested.statusCode !== 200) {
    throw new Error(`Failed to request test contract authorisation: ${requested.body}`);
  }

  const authorised = await app.inject({
    method: 'POST',
    url: `/api/change-contracts/${contract.id}/authorise`,
    headers: {
      ...actorHeaders,
      'idempotency-key': `authorise-contract-${taskId}`,
      'if-match': '"2"',
    },
    payload: {},
  });
  if (authorised.statusCode !== 200) {
    throw new Error(`Failed to authorise test contract: ${authorised.body}`);
  }
  return (authorised.json() as { contract: { id: string; hash: string } }).contract;
}
