import type { InvocationEvent } from '@roleflock/contracts';
import {
  providerDriver,
  type InvocationRequest,
  type ProviderAdapter,
  type ProviderCapabilities,
} from '@roleflock/provider-core';
import { describe, expect, it } from 'vitest';
import { runDriverConformance } from './driver-conformance.js';

/**
 * The compatibility wrapper has to pass the same suite a hand-written driver
 * does. If it did not, "migrate to drivers" would mean rewriting every adapter
 * before anything could move, which is exactly the big-bang the migration plan
 * forbids.
 */

const CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  tools: true,
  writes: true,
  headless: true,
  structuredOutput: false,
};

/** An adapter that behaves the way a well-implemented CLI integration does. */
function wellBehavedAdapter(): ProviderAdapter {
  return {
    id: 'codex-like',
    capabilities: CAPABILITIES,
    // eslint-disable-next-line @typescript-eslint/require-await
    async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
      yield { type: 'invocation.started', invocationId: request.invocationId };
      yield { type: 'model.output.delta', text: `working on: ${request.prompt}` };
      yield { type: 'invocation.completed', output: 'done' };
    },
    healthCheck: async () => ({ status: 'ready' as const, binary: '/usr/bin/codex-like' }),
  };
}

const options = {
  request: (overrides = {}) => ({
    invocationKey: 'inv_conformance',
    objective: 'investigate the failure',
    workspacePath: '/tmp/worktree',
    permissions: { workspaceWrite: true, network: false },
    ...overrides,
  }),
};

describe('an adapter presented as a driver', () => {
  it('passes the full conformance suite', async () => {
    const failures = await runDriverConformance(providerDriver(wellBehavedAdapter()), options);

    expect(failures).toEqual([]);
  });

  it('still passes when the adapter reports usage', async () => {
    const withUsage: ProviderAdapter = {
      ...wellBehavedAdapter(),
      // eslint-disable-next-line @typescript-eslint/require-await
      async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
        yield { type: 'invocation.started', invocationId: request.invocationId };
        yield { type: 'usage.updated', usage: { inputTokens: 5, outputTokens: 7 } };
        yield { type: 'invocation.completed', output: 'done' };
      },
    };

    // Usage reporting is only claimed when it is overridden, so the default
    // wrapper must not fail for emitting none.
    expect(
      await runDriverConformance(
        providerDriver(withUsage, { capabilities: { usageReporting: true } }),
        options,
      ),
    ).toEqual([]);
  });

  it('cannot be made to overclaim cancellation at all', async () => {
    // `cancellation` is not in the override type, and a cast cannot route
    // around it either — the wrapper restates it. This matters because such a
    // lie would be *self-consistent*: interrupt would agree with the claim,
    // conformance would find no contradiction, and a user would be told their
    // work stopped while a paid provider carried on.
    const forced = providerDriver(wellBehavedAdapter(), {
      capabilities: { cancellation: 'remote-confirmed' } as never,
    });

    expect((await forced.capabilities()).cancellation).toBe('local-process');
    expect((await forced.interrupt!('inv_conformance')).stopped).toBe(false);
    expect(await runDriverConformance(forced, options)).toEqual([]);
  });

  it('fails conformance if it claims resume it does not implement', async () => {
    const failures = await runDriverConformance(
      providerDriver(wellBehavedAdapter(), { capabilities: { resume: true } }),
      options,
    );

    expect(failures.map((failure) => failure.check)).toContain('resume/claimed-not-implemented');
  });

  it("passes even when the adapter would ignore its envelope, because conformance's probe never reaches it", async () => {
    const disobedient: ProviderAdapter = {
      ...wellBehavedAdapter(),
      // eslint-disable-next-line @typescript-eslint/require-await
      async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
        yield { type: 'invocation.started', invocationId: request.invocationId };
        yield { type: 'invocation.completed', output: 'wrote anyway' };
      },
    };

    // Conformance probes with the objective "write to the workspace", which the
    // wrapper's early guard matches, so this adapter is never invoked. The
    // result is honest but narrow: it shows the guard fires, *not* that an
    // adapter is prevented from writing. That is the envelope's job, and it is
    // enforced by the CLI sandbox rather than by anything here.
    expect(await runDriverConformance(providerDriver(disobedient), options)).toEqual([]);
  });
});
