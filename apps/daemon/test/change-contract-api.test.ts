import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup !== undefined) await cleanup();
  }
});

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'roleflock-contract-api-data-'));
  const repositoryDir = await mkdtemp(join(tmpdir(), 'roleflock-contract-api-repo-'));
  execFileSync('git', ['init'], { cwd: repositoryDir });
  execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], {
    cwd: repositoryDir,
  });
  execFileSync('git', ['config', 'user.name', 'RoleFlock Test'], {
    cwd: repositoryDir,
  });
  await writeFile(join(repositoryDir, 'README.md'), '# Contract API fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repositoryDir });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repositoryDir });

  const session = { token: 'test-token', csrf: 'test-csrf' };
  const server = await createServer({ dataDir, session });
  cleanups.push(async () => {
    await server.app.close();
    await rm(dataDir, { recursive: true, force: true });
    await rm(repositoryDir, { recursive: true, force: true });
  });

  const headers = {
    'x-roleflock-token': session.token,
    'x-roleflock-csrf': session.csrf,
    'x-roleflock-actor-id': 'user_fikri',
    'content-type': 'application/json',
  };
  const projectResponse = await server.app.inject({
    method: 'POST',
    url: '/api/projects',
    headers,
    payload: { path: repositoryDir },
  });
  const project = projectResponse.json() as { id: string };
  const taskResponse = await server.app.inject({
    method: 'POST',
    url: '/api/tasks',
    headers,
    payload: {
      projectId: project.id,
      type: 'bug_fix',
      title: 'Idempotent checkout',
      brief: 'Prevent duplicate checkout submissions.',
      risk: 'high',
    },
  });
  const task = taskResponse.json() as { id: string };
  return { app: server.app, headers, task };
}

function contractBody() {
  return {
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
        locator: 'request://checkout-idempotency',
        digest: 'a'.repeat(64),
      },
    ],
    unresolvedQuestions: [],
  };
}

function mutationHeaders(
  base: Record<string, string>,
  idempotencyKey: string,
  revision?: number,
): Record<string, string> {
  return {
    ...base,
    'idempotency-key': idempotencyKey,
    ...(revision === undefined ? {} : { 'if-match': `"${revision}"` }),
  };
}

describe('Change Contract API', () => {
  it('blocks task start until the exact current contract is authorised', async () => {
    const { app, headers, task } = await fixture();

    const missing = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/start`,
      headers,
      payload: {},
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toMatchObject({ code: 'CHANGE_CONTRACT_REQUIRED' });

    const created = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/change-contract`,
      headers: mutationHeaders(headers, 'create-start-gate'),
      payload: contractBody(),
    });
    const contractId = (created.json() as { contract: { id: string } }).contract.id;

    const draft = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/start`,
      headers,
      payload: {},
    });
    expect(draft.statusCode).toBe(409);
    expect(draft.json()).toMatchObject({
      code: 'CHANGE_CONTRACT_NOT_AUTHORISED',
      contractId,
      contractStatus: 'draft',
      revision: 1,
    });
  });

  it('creates, idempotently replays, version-checks, and authorises a contract', async () => {
    const { app, headers, task } = await fixture();
    const createHeaders = mutationHeaders(headers, 'create-contract-1');
    const created = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/change-contract`,
      headers: createHeaders,
      payload: contractBody(),
    });

    expect(created.statusCode).toBe(201);
    expect(created.headers.etag).toBe('"1"');
    const createdBody = created.json() as {
      contract: { id: string; status: string; hash: string };
      aggregate: { revision: number };
      replayed: boolean;
    };
    expect(createdBody).toMatchObject({
      contract: { status: 'draft' },
      aggregate: { revision: 1 },
      replayed: false,
    });

    const replay = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/change-contract`,
      headers: createHeaders,
      payload: contractBody(),
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({
      contract: { id: createdBody.contract.id, hash: createdBody.contract.hash },
      replayed: true,
    });

    const reused = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/change-contract`,
      headers: createHeaders,
      payload: { ...contractBody(), objective: 'Different request.' },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });

    const requested = await app.inject({
      method: 'POST',
      url: `/api/change-contracts/${createdBody.contract.id}/authorisation-request`,
      headers: mutationHeaders(headers, 'request-authorisation-1', 1),
      payload: {},
    });
    expect(requested.statusCode).toBe(200);
    expect(requested.headers.etag).toBe('"2"');
    expect(requested.json()).toMatchObject({
      contract: { status: 'awaiting_authorisation' },
      aggregate: { revision: 2 },
    });

    const stale = await app.inject({
      method: 'POST',
      url: `/api/change-contracts/${createdBody.contract.id}/authorise`,
      headers: mutationHeaders(headers, 'authorise-stale', 1),
      payload: {},
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({
      code: 'CONTRACT_REVISION_CONFLICT',
      expectedRevision: 1,
      actualRevision: 2,
    });

    const authorised = await app.inject({
      method: 'POST',
      url: `/api/change-contracts/${createdBody.contract.id}/authorise`,
      headers: mutationHeaders(headers, 'authorise-1', 2),
      payload: {},
    });
    expect(authorised.statusCode).toBe(200);
    expect(authorised.headers.etag).toBe('"3"');
    expect(authorised.json()).toMatchObject({
      contract: {
        status: 'authorised',
        authorisedBy: 'user_fikri',
      },
      aggregate: { revision: 3 },
    });

    const revised = await app.inject({
      method: 'POST',
      url: `/api/change-contracts/${createdBody.contract.id}/revisions`,
      headers: mutationHeaders(headers, 'revise-1', 3),
      payload: {
        objective: 'Prevent duplicates and replay the original checkout response.',
        changeReason: 'Clarify response replay.',
      },
    });
    expect(revised.statusCode).toBe(201);
    expect(revised.headers.etag).toBe('"4"');
    expect(revised.json()).toMatchObject({
      contract: {
        version: 2,
        parentVersionId: `${createdBody.contract.id}:v1`,
        status: 'draft',
      },
      aggregate: { revision: 4 },
    });

    const edited = await app.inject({
      method: 'PATCH',
      url: `/api/change-contracts/${createdBody.contract.id}/draft`,
      headers: mutationHeaders(headers, 'edit-revision-1', 4),
      payload: {
        objective: 'Prevent duplicate orders and replay the original checkout response.',
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.headers.etag).toBe('"5"');
    expect(edited.json()).toMatchObject({
      contract: {
        version: 2,
        objective: 'Prevent duplicate orders and replay the original checkout response.',
      },
      aggregate: { revision: 5 },
    });

    const versions = await app.inject({
      method: 'GET',
      url: `/api/change-contracts/${createdBody.contract.id}/versions`,
      headers,
    });
    expect(versions.statusCode).toBe(200);
    expect(versions.json()).toMatchObject({
      aggregate: { revision: 5, status: 'draft' },
      versions: [
        { contract: { version: 1, status: 'authorised' } },
        { contract: { version: 2, status: 'draft' } },
      ],
    });
  });

  it('requires idempotency and revision precondition headers', async () => {
    const { app, headers, task } = await fixture();
    const missingIdempotency = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/change-contract`,
      headers,
      payload: contractBody(),
    });
    expect(missingIdempotency.statusCode).toBe(400);
    expect(missingIdempotency.json()).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });

    const created = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/change-contract`,
      headers: mutationHeaders(headers, 'create-contract-precondition'),
      payload: contractBody(),
    });
    const contractId = (created.json() as { contract: { id: string } }).contract.id;
    const missingRevision = await app.inject({
      method: 'POST',
      url: `/api/change-contracts/${contractId}/authorisation-request`,
      headers: mutationHeaders(headers, 'request-without-revision'),
      payload: {},
    });
    expect(missingRevision.statusCode).toBe(428);
    expect(missingRevision.json()).toMatchObject({
      code: 'REVISION_PRECONDITION_REQUIRED',
    });
  });

  it('returns structured schema failures without storing an invalid contract', async () => {
    const { app, headers, task } = await fixture();
    const invalid = await app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/change-contract`,
      headers: mutationHeaders(headers, 'create-invalid-contract'),
      payload: { ...contractBody(), acceptanceCriteria: [] },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toMatchObject({
      code: 'INVALID_CHANGE_CONTRACT',
      issues: expect.any(Array),
    });

    const read = await app.inject({
      method: 'GET',
      url: `/api/tasks/${task.id}/change-contract`,
      headers,
    });
    expect(read.statusCode).toBe(404);
  });
});
