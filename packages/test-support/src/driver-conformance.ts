import {
  stopIsConfirmable,
  type AgentDriver,
  type AgentEvent,
  type AgentRunRequest,
} from '@roleflock/provider-core';

/**
 * The conformance suite every AgentDriver must pass.
 *
 * Written as plain assertions rather than a test framework so a driver package
 * can run it inside its own suite. It checks the promises the runtime relies on
 * — not that a driver is useful, but that what it *claims* is true, because an
 * untruthful capability is worse than a missing one.
 */

export interface ConformanceFailure {
  check: string;
  detail: string;
}

export interface ConformanceOptions {
  /** Builds a request the driver can actually serve. */
  request: (overrides?: Partial<AgentRunRequest>) => AgentRunRequest;
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const seen: AgentEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

export async function runDriverConformance(
  driver: AgentDriver,
  options: ConformanceOptions,
): Promise<ConformanceFailure[]> {
  const failures: ConformanceFailure[] = [];
  const fail = (check: string, detail: string) => failures.push({ check, detail });

  const capabilities = await driver.capabilities();
  const availability = await driver.detect();

  // --- Availability ---------------------------------------------------------
  if (availability.authenticated && !availability.detected) {
    fail(
      'detect/authenticated-implies-detected',
      'reported authenticated without being detected, which cannot be true',
    );
  }

  // --- A run emits a coherent event sequence --------------------------------
  const events = await collect(driver.start(options.request()));
  if (events.length === 0) {
    fail('start/emits-events', 'emitted no events at all');
    return failures;
  }
  if (events[0]?.type !== 'started') {
    fail('start/first-event', `first event was '${events[0]?.type}', expected 'started'`);
  }
  const settled = events.filter((event) => event.type === 'settled');
  if (settled.length !== 1) {
    fail('start/settles-once', `emitted ${settled.length} settled events, expected exactly 1`);
  }
  if (events.at(-1)?.type !== 'settled') {
    fail('start/settles-last', 'emitted events after settling');
  }

  // --- Claims match behaviour ----------------------------------------------
  if (capabilities.usageReporting && !events.some((event) => event.type === 'usage')) {
    fail('usage/claimed-not-emitted', 'claims usage reporting but emitted no usage event');
  }
  if (capabilities.sessions) {
    const started = events.find((event) => event.type === 'started');
    if (started?.type === 'started' && started.sessionId === undefined) {
      fail('sessions/claimed-no-id', 'claims sessions but started without a session id');
    }
  }
  if (capabilities.resume && driver.resume === undefined) {
    fail('resume/claimed-not-implemented', 'claims resume but implements no resume()');
  } else if (capabilities.resume && driver.resume !== undefined) {
    const started = events.find((event) => event.type === 'started');
    const sessionId = started?.type === 'started' ? started.sessionId : undefined;
    if (sessionId === undefined) {
      // Resume needs something to resume. A driver that claims it but never
      // hands back an id has given the caller no way to use it.
      fail('resume/no-session-to-resume', 'claims resume but never reported a session id');
    } else {
      const resumed = await collect(driver.resume(sessionId, options.request()));
      const settledResume = resumed.filter((event) => event.type === 'settled');
      if (settledResume.length !== 1) {
        fail(
          'resume/settles-once',
          `resume emitted ${settledResume.length} settled events, expected exactly 1`,
        );
      }
      if (settledResume[0]?.type === 'settled' && settledResume[0].outcome === 'refused') {
        fail('resume/claimed-then-refused', 'claims resume but refused when asked to');
      }
    }
  }
  if (!capabilities.resume && driver.resume !== undefined) {
    // Having the method is not a claim; behaving as though resume worked is.
    // A driver that offers the entry point must refuse it rather than quietly
    // starting a fresh turn, because the caller would believe prior context was
    // carried when it was not.
    const attempted = await collect(
      driver.resume('session-that-does-not-exist', options.request()),
    );
    const settledAttempt = attempted.filter((event) => event.type === 'settled');
    if (
      settledAttempt[0]?.type === 'settled' &&
      settledAttempt[0].outcome !== 'refused' &&
      settledAttempt[0].outcome !== 'failed'
    ) {
      fail(
        'resume/unclaimed-but-succeeded',
        'does not claim resume but reported success when asked to resume, so a caller cannot tell whether context was carried',
      );
    }
  }

  // --- Permissions are a ceiling, not a suggestion --------------------------
  const refusal = await collect(
    driver.start(
      options.request({
        objective: 'write to the workspace',
        permissions: { workspaceWrite: false, network: false },
      }),
    ),
  );
  const refusalOutcome = refusal.at(-1);
  if (refusalOutcome?.type === 'settled' && refusalOutcome.outcome === 'completed') {
    fail(
      'permissions/exceeded',
      'completed a write objective while workspace write was denied; a driver must refuse rather than proceed',
    );
  }

  // --- Cancellation truthfulness -------------------------------------------
  if (capabilities.cancellation !== 'none') {
    if (driver.interrupt === undefined) {
      fail(
        'cancellation/claimed-not-implemented',
        'claims cancellation but implements no interrupt()',
      );
    } else {
      const request = options.request();
      const result = await driver.interrupt(request.invocationKey);
      if (result.capability !== capabilities.cancellation) {
        fail(
          'cancellation/capability-mismatch',
          `interrupt reported '${result.capability}' but capabilities say '${capabilities.cancellation}'`,
        );
      }
      if (result.stopped && !stopIsConfirmable(result.capability)) {
        // The most expensive lie a driver can tell: the user is told their work
        // stopped while a paid provider may still be running it.
        fail(
          'cancellation/unprovable-stop',
          `reported work as stopped with only '${result.capability}' capability, which cannot confirm it`,
        );
      }
    }
  } else if (driver.interrupt !== undefined) {
    fail(
      'cancellation/implemented-not-claimed',
      'implements interrupt() but claims it cannot cancel',
    );
  }

  return failures;
}
