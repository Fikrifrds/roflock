import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A disconnected Studio must not look like a quiet one.
 *
 * The shell set "Connected" the moment bootstrap succeeded and never revised it,
 * so a dead event stream kept displaying the last state it had seen. A stalled
 * run read as a running one, and the operator's reason to intervene was the
 * very thing the screen was hiding.
 */

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static readonly CLOSED = 2;
  static readonly CONNECTING = 0;

  onmessage: (() => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  closed = false;

  constructor() {
    FakeEventSource.instances.push(this);
  }
  addEventListener() {}
  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function mountStream() {
  const { createApi } = await import('../src/lib/api.js');
  const api = createApi();
  const statuses: string[] = [];
  const events: number[] = [];
  api.stream(
    () => events.push(1),
    (status) => statuses.push(status),
  );
  return { source: FakeEventSource.instances[0]!, statuses, events };
}

describe('the event stream status', () => {
  it('reports a terminal drop as disconnected rather than staying silent', async () => {
    const { source, statuses } = await mountStream();

    source.readyState = FakeEventSource.CLOSED;
    source.onerror?.();

    expect(statuses).toContain('closed');
  });

  it('distinguishes a retrying drop from a terminal one', async () => {
    const { source, statuses } = await mountStream();

    source.readyState = FakeEventSource.CONNECTING;
    source.onerror?.();

    // EventSource retries this one on its own, so the wording must not send the
    // operator off to reload for something that fixes itself.
    expect(statuses).toContain('reconnecting');
    expect(statuses).not.toContain('closed');
  });

  it('clears the warning when the stream comes back', async () => {
    const { source, statuses } = await mountStream();

    source.readyState = FakeEventSource.CONNECTING;
    source.onerror?.();
    source.onopen?.();

    // A banner that appears on failure and never clears teaches people to ignore it.
    expect(statuses.at(-1)).toBe('live');
  });

  it('refetches on reconnect, because nothing missed is replayed', async () => {
    const { source, events } = await mountStream();

    source.onopen?.();

    // EventSource replays no history. Without this the view stays frozen at
    // whatever it knew before the drop while confidently reporting "Connected".
    expect(events.length).toBeGreaterThan(0);
  });
});
