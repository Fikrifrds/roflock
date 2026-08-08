import type { AgentDriver, AgentEvent, AgentRunRequest } from '@roleflock/provider-core';
import { describe, expect, it } from 'vitest';
import { runDriverConformance } from './driver-conformance.js';
import { FAKE_DRIVER_CAPABILITIES, FakeDriver } from './fake-driver.js';

/**
 * The conformance suite has to catch a driver that lies about itself, so it is
 * tested against drivers that do.
 */

function request(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    invocationKey: 'inv_test',
    objective: 'do the thing',
    workspacePath: '/tmp/workspace',
    permissions: { workspaceWrite: true, network: false },
    ...overrides,
  };
}

const options = { request };

/** A driver whose behaviour can be broken one promise at a time. */
function brokenDriver(
  overrides: Partial<AgentDriver> & { capabilities?: never } = {},
): AgentDriver {
  const fake = new FakeDriver();
  return {
    id: 'broken',
    detect: () => fake.detect(),
    capabilities: () => fake.capabilities(),
    start: (input) => fake.start(input),
    resume: (sessionId, input) => fake.resume(sessionId, input),
    interrupt: (key) => fake.interrupt(key),
    ...overrides,
  };
}

describe('the reference driver conforms', () => {
  it('passes every check', async () => {
    expect(await runDriverConformance(new FakeDriver(), options)).toEqual([]);
  });
});

describe('the suite catches a driver that overstates itself', () => {
  it('catches a claim of cancellation it cannot confirm', async () => {
    const driver = brokenDriver({
      capabilities: undefined,
    });
    const lying: AgentDriver = {
      ...driver,
      capabilities: async () => ({ ...FAKE_DRIVER_CAPABILITIES, cancellation: 'local-process' }),
      interrupt: async () => ({ stopped: true, capability: 'local-process' as const }),
    };

    const failures = await runDriverConformance(lying, options);

    // Killing a local process says nothing about a request already in flight to
    // a paid provider. Reporting it as stopped is the most expensive lie a
    // driver can tell.
    expect(failures.map((failure) => failure.check)).toContain('cancellation/unprovable-stop');
  });

  it('catches a capability that disagrees with what interrupt reports', async () => {
    const inconsistent: AgentDriver = {
      ...brokenDriver(),
      interrupt: async () => ({ stopped: false, capability: 'cooperative' as const }),
    };

    expect(
      (await runDriverConformance(inconsistent, options)).map((failure) => failure.check),
    ).toContain('cancellation/capability-mismatch');
  });

  it('catches a claim of usage reporting that emits none', async () => {
    const silent: AgentDriver = {
      ...brokenDriver(),
      start: async function* (): AsyncIterable<AgentEvent> {
        yield { type: 'started', sessionId: 'session_1' };
        yield { type: 'settled', outcome: 'completed' };
      },
    };

    expect((await runDriverConformance(silent, options)).map((failure) => failure.check)).toContain(
      'usage/claimed-not-emitted',
    );
  });

  it('catches a driver that exceeds the permissions it was given', async () => {
    const overreaching: AgentDriver = {
      ...brokenDriver(),
      start: async function* (): AsyncIterable<AgentEvent> {
        yield { type: 'started', sessionId: 'session_1' };
        yield { type: 'usage', inputTokens: 1, outputTokens: 1 };
        // Completes a write objective although write was denied.
        yield { type: 'settled', outcome: 'completed' };
      },
    };

    expect(
      (await runDriverConformance(overreaching, options)).map((failure) => failure.check),
    ).toContain('permissions/exceeded');
  });

  it('catches an incoherent event sequence', async () => {
    const disordered: AgentDriver = {
      ...brokenDriver(),
      start: async function* (): AsyncIterable<AgentEvent> {
        yield { type: 'output', text: 'no start event' };
        yield { type: 'settled', outcome: 'completed' };
        yield { type: 'output', text: 'after settling' };
      },
    };
    const checks = (await runDriverConformance(disordered, options)).map(
      (failure) => failure.check,
    );

    expect(checks).toContain('start/first-event');
    expect(checks).toContain('start/settles-last');
  });

  it('catches claiming authentication without detection', async () => {
    const impossible: AgentDriver = {
      ...brokenDriver(),
      detect: async () => ({ detected: false, authenticated: true }),
    };

    expect(
      (await runDriverConformance(impossible, options)).map((failure) => failure.check),
    ).toContain('detect/authenticated-implies-detected');
  });

  it('catches resume claimed but not implemented', async () => {
    const { resume: _dropped, ...withoutResume } = brokenDriver();

    expect(
      (await runDriverConformance(withoutResume as AgentDriver, options)).map(
        (failure) => failure.check,
      ),
    ).toContain('resume/claimed-not-implemented');
  });
});

describe('the fake driver behaves deterministically', () => {
  it('refuses a write objective when write is denied', async () => {
    const driver = new FakeDriver();
    const events: AgentEvent[] = [];
    for await (const event of driver.start(
      request({
        objective: 'write a file',
        permissions: { workspaceWrite: false, network: false },
      }),
    )) {
      events.push(event);
    }

    expect(events.at(-1)).toEqual({
      type: 'settled',
      outcome: 'refused',
      detail: 'workspace write not permitted',
    });
  });

  it('scripts a different outcome per attempt of the same turn', async () => {
    const driver = new FakeDriver({ outcomes: { inv_test: ['failed', 'completed'] } });

    const first: AgentEvent[] = [];
    for await (const event of driver.start(request())) first.push(event);
    const second: AgentEvent[] = [];
    for await (const event of driver.start(request())) second.push(event);

    expect(first.at(-1)).toMatchObject({ outcome: 'failed' });
    expect(second.at(-1)).toMatchObject({ outcome: 'completed' });
    expect(driver.timesStarted('inv_test')).toBe(2);
  });

  it('counts starts per invocation key so duplicate work is visible', async () => {
    const driver = new FakeDriver();
    for await (const _ of driver.start(request({ invocationKey: 'inv_a' }))) void _;
    for await (const _ of driver.start(request({ invocationKey: 'inv_b' }))) void _;

    expect(driver.timesStarted('inv_a')).toBe(1);
    expect(driver.timesStarted('inv_b')).toBe(1);
    expect(driver.timesStarted('inv_never')).toBe(0);
  });
});
