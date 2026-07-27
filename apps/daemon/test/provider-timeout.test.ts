import { classifyFailure } from '@roleflock/graph-runtime';
import { describe, expect, it } from 'vitest';
import {
  createIdleWatchdog,
  providerIdleTimeoutMs,
  ProviderIdleTimeoutError,
} from '../src/services/orchestrator.js';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('provider idle watchdog', () => {
  it('gives up only after the provider has been silent for the whole budget', async () => {
    const watchdog = createIdleWatchdog(new AbortController().signal, 120);
    await tick(80);
    expect(watchdog.signal.aborted).toBe(false);

    // A CLI that is still streaming is still working, so each sign of life
    // buys the turn another full budget rather than counting against it.
    watchdog.touch();
    await tick(80);
    expect(watchdog.signal.aborted).toBe(false);

    await tick(120);
    expect(watchdog.signal.aborted).toBe(true);
    expect(watchdog.expired()).toBe(true);
    watchdog.dispose();
  });

  it('does not blame the budget when the operator aborted', async () => {
    const operator = new AbortController();
    const watchdog = createIdleWatchdog(operator.signal, 10_000);
    operator.abort();

    expect(watchdog.signal.aborted).toBe(true);
    // The distinction the run depends on: a Stop must stay a Stop, or the task
    // reports a timeout the operator never hit.
    expect(watchdog.expired()).toBe(false);
    watchdog.dispose();
  });

  it('stops holding a timer once disposed', async () => {
    const watchdog = createIdleWatchdog(new AbortController().signal, 30);
    watchdog.dispose();
    await tick(60);
    expect(watchdog.signal.aborted).toBe(false);
  });

  it('reads the budget from the environment and falls back to the legacy name', () => {
    const previous = {
      idle: process.env.ROLEFLOCK_PROVIDER_IDLE_TIMEOUT_MS,
      legacy: process.env.ROLEFLOCK_PROVIDER_TIMEOUT_MS,
    };
    try {
      delete process.env.ROLEFLOCK_PROVIDER_IDLE_TIMEOUT_MS;
      delete process.env.ROLEFLOCK_PROVIDER_TIMEOUT_MS;
      expect(providerIdleTimeoutMs()).toBe(300_000);

      process.env.ROLEFLOCK_PROVIDER_TIMEOUT_MS = '1234';
      expect(providerIdleTimeoutMs()).toBe(1234);

      process.env.ROLEFLOCK_PROVIDER_IDLE_TIMEOUT_MS = '4321';
      expect(providerIdleTimeoutMs()).toBe(4321);

      process.env.ROLEFLOCK_PROVIDER_IDLE_TIMEOUT_MS = 'nonsense';
      expect(providerIdleTimeoutMs()).toBe(300_000);
    } finally {
      if (previous.idle === undefined) delete process.env.ROLEFLOCK_PROVIDER_IDLE_TIMEOUT_MS;
      else process.env.ROLEFLOCK_PROVIDER_IDLE_TIMEOUT_MS = previous.idle;
      if (previous.legacy === undefined) delete process.env.ROLEFLOCK_PROVIDER_TIMEOUT_MS;
      else process.env.ROLEFLOCK_PROVIDER_TIMEOUT_MS = previous.legacy;
    }
  });
});

describe('provider timeout classification', () => {
  it('is a timeout, not a cancellation', () => {
    // A timeout dressed up as a cancellation is routed nowhere: `cancelled`
    // skips the local retry budget and every typed failure edge, so one slow
    // turn used to end the run at attempt 1 of 3.
    const error = new ProviderIdleTimeoutError(90_000);
    expect(classifyFailure(error)).toBe('timeout');
    expect(error.message).toContain('timed out');
    expect(error.message).toContain('ROLEFLOCK_PROVIDER_IDLE_TIMEOUT_MS');
  });

  it('still classifies an operator stop as cancelled', () => {
    expect(classifyFailure(new Error('Cancelled by operator'))).toBe('cancelled');
  });
});
