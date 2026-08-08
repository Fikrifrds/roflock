import type { InvocationEvent } from '@roleflock/contracts';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from './driver.js';
import { providerDriver } from './provider-driver.js';
import type { InvocationRequest, ProviderAdapter, ProviderCapabilities } from './index.js';

/**
 * The compatibility wrapper is what lets the working Codex, Claude and Cursor
 * integrations answer the driver contract before any of them is rewritten. It
 * has to be pessimistic: every claim it makes on an adapter's behalf is one the
 * runtime will act on.
 */

const CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  tools: true,
  writes: true,
  headless: true,
  structuredOutput: false,
};

function adapter(
  events: InvocationEvent[],
  overrides: Partial<ProviderAdapter> = {},
): ProviderAdapter {
  return {
    id: 'fake-cli',
    capabilities: CAPABILITIES,
    // eslint-disable-next-line @typescript-eslint/require-await
    async *invoke(_request: InvocationRequest): AsyncIterable<InvocationEvent> {
      for (const event of events) yield event;
    },
    healthCheck: async () => ({
      status: 'ready' as const,
      binary: '/usr/bin/fake',
      version: '1.2',
    }),
    ...overrides,
  };
}

const request = {
  invocationKey: 'inv_1',
  objective: 'investigate the failure',
  workspacePath: '/tmp/worktree',
  permissions: { workspaceWrite: true, network: false },
};

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const seen: AgentEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

describe('mapping an adapter onto the driver contract', () => {
  it('translates a normal turn', async () => {
    const driver = providerDriver(
      adapter([
        { type: 'invocation.started', invocationId: 'inv_1' },
        { type: 'model.output.delta', text: 'looking' },
        { type: 'usage.updated', usage: { inputTokens: 12, outputTokens: 34 } },
        { type: 'invocation.completed', output: 'done' },
      ]),
    );

    expect(await collect(driver.start(request))).toEqual([
      { type: 'started' },
      { type: 'output', text: 'looking' },
      { type: 'usage', inputTokens: 12, outputTokens: 34 },
      { type: 'settled', outcome: 'completed' },
    ]);
  });

  it('reports a failure with the reason the adapter gave', async () => {
    const driver = providerDriver(
      adapter([
        { type: 'invocation.started', invocationId: 'inv_1' },
        {
          type: 'invocation.failed',
          error: { code: 'quota', message: 'usage limit reached' },
        },
      ]),
    );

    expect((await collect(driver.start(request))).at(-1)).toEqual({
      type: 'settled',
      outcome: 'failed',
      detail: 'usage limit reached',
    });
  });

  it('does not call an adapter that ended without an outcome a success', async () => {
    const driver = providerDriver(adapter([{ type: 'invocation.started', invocationId: 'inv_1' }]));

    // The difference between an unknown outcome and a fabricated one.
    expect((await collect(driver.start(request))).at(-1)).toEqual({
      type: 'settled',
      outcome: 'failed',
      detail: 'adapter ended without an outcome',
    });
  });

  it('emits a start event even when the adapter forgets to', async () => {
    const driver = providerDriver(
      adapter([
        { type: 'model.output.delta', text: 'straight to work' },
        { type: 'invocation.completed', output: 'done' },
      ]),
    );
    const events = await collect(driver.start(request));

    expect(events[0]).toEqual({ type: 'started' });
  });

  it('drops runtime concepts that have no place in a provider seam', async () => {
    const driver = providerDriver(
      adapter([
        { type: 'invocation.started', invocationId: 'inv_1' },
        { type: 'heartbeat', at: '2026-08-08T10:00:00.000Z' },
        { type: 'phase.changed', phase: 'reasoning' },
        { type: 'invocation.completed', output: 'done' },
      ]),
    );

    expect((await collect(driver.start(request))).map((event) => event.type)).toEqual([
      'started',
      'settled',
    ]);
  });
});

describe('the wrapper is pessimistic about what it promises', () => {
  it('never claims better than local-process cancellation', async () => {
    const driver = providerDriver(adapter([]));

    // Killing a local CLI says nothing about a request already in flight to a
    // paid API. This is the one lie conformance exists to catch.
    expect((await driver.capabilities()).cancellation).toBe('local-process');
    expect((await driver.interrupt!('inv_1')).stopped).toBe(false);
  });

  it('reports unverified rather than ready when the adapter has no health check', async () => {
    const driver = providerDriver(adapter([], { healthCheck: undefined }));

    // Nothing was verified, so nothing may be claimed — reporting ready would
    // send a run to a CLI that may not be installed or logged in.
    expect(await driver.detect()).toMatchObject({ detected: false, authenticated: false });
  });

  it('keeps detection and authentication apart', async () => {
    const driver = providerDriver(
      adapter([], { healthCheck: async () => ({ status: 'unauthenticated' as const }) }),
    );

    expect(await driver.detect()).toMatchObject({ detected: true, authenticated: false });
  });

  it('refuses a write objective the run was not granted', async () => {
    const driver = providerDriver(
      adapter([
        { type: 'invocation.started', invocationId: 'inv_1' },
        { type: 'invocation.completed', output: 'wrote it anyway' },
      ]),
    );

    const events = await collect(
      driver.start({
        ...request,
        objective: 'modify the payment module',
        permissions: { workspaceWrite: false, network: false },
      }),
    );

    // An adapter cannot enforce a restriction the envelope never told it about,
    // so the refusal happens here rather than being sent and hoped about.
    expect(events).toEqual([
      {
        type: 'settled',
        outcome: 'refused',
        detail: 'objective requires workspace write, which this run was not granted',
      },
    ]);
  });

  it('passes a read-only envelope through for a read-only objective', async () => {
    let seen: InvocationRequest | undefined;
    const driver = providerDriver(
      adapter([{ type: 'invocation.completed', output: 'ok' }], {
        // eslint-disable-next-line @typescript-eslint/require-await
        async *invoke(input: InvocationRequest): AsyncIterable<InvocationEvent> {
          seen = input;
          yield { type: 'invocation.completed', output: 'ok' };
        },
      }),
    );

    await collect(
      driver.start({ ...request, permissions: { workspaceWrite: false, network: false } }),
    );

    expect(seen?.permissionEnvelope).toEqual({
      worktree: '/tmp/worktree',
      allowedPaths: [],
      allowCommands: false,
    });
  });
});

describe('what the permission guard does and does not do', () => {
  async function objectiveReaching(adapterEvents: InvocationEvent[], objective: string) {
    let reached: InvocationRequest | undefined;
    const driver = providerDriver(
      adapter(adapterEvents, {
        // eslint-disable-next-line @typescript-eslint/require-await
        async *invoke(input: InvocationRequest): AsyncIterable<InvocationEvent> {
          reached = input;
          for (const event of adapterEvents) yield event;
        },
      }),
    );
    await collect(
      driver.start({
        ...request,
        objective,
        permissions: { workspaceWrite: false, network: false },
      }),
    );
    return reached;
  }

  const completed: InvocationEvent[] = [{ type: 'invocation.completed', output: 'ok' }];

  it.each(['modify the payment module', 'write a file', 'edit the config', 'patch the bug'])(
    'refuses %j before the adapter is invoked',
    async (objective) => {
      expect(await objectiveReaching(completed, objective)).toBeUndefined();
    },
  );

  it.each(['refactor billing', 'improve the payment module', 'clean up the module'])(
    'lets %j through, because word matching is not a security boundary',
    async (objective) => {
      const reached = await objectiveReaching(completed, objective);

      // This is the honest limit of the guard. What actually confines the
      // adapter is the envelope it receives, enforced by the CLI sandbox.
      expect(reached).toBeDefined();
      expect(reached?.permissionEnvelope).toEqual({
        worktree: '/tmp/worktree',
        allowedPaths: [],
        allowCommands: false,
      });
    },
  );
});
