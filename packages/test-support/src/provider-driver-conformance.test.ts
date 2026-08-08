import type { InvocationEvent } from '@roleflock/contracts';
import type { AgentEvent } from '@roleflock/provider-core';
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

  it('fails conformance if it claims resume with nothing to resume', async () => {
    const failures = await runDriverConformance(
      providerDriver(wellBehavedAdapter(), { capabilities: { resume: true } }),
      options,
    );

    // This adapter reports no session id, so a caller has no handle to resume
    // with. Claiming the capability while never producing one leaves the promise
    // unusable — a more precise failure than "not implemented".
    expect(failures.map((failure) => failure.check)).toContain('resume/no-session-to-resume');
  });

  it('refuses rather than pretends when asked to resume without claiming it', async () => {
    const driver = providerDriver(wellBehavedAdapter());
    const events: AgentEvent[] = [];
    for await (const event of driver.resume!('some-session', options.request())) {
      events.push(event);
    }

    // Silently starting fresh would let a caller believe prior context was
    // carried. Conformance passes precisely because it refuses.
    expect(events.at(-1)).toMatchObject({ type: 'settled', outcome: 'refused' });
    expect(await runDriverConformance(driver, options)).toEqual([]);
  });

  it("passes even when the adapter would ignore its envelope, because conformance's probe never reaches it", async () => {
    const disobedient: ProviderAdapter = {
      ...wellBehavedAdapter(),
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
