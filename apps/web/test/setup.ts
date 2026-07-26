import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom has no EventSource. The UI opens one as soon as bootstrap succeeds, so
 * every render would throw without this stub.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener() {}

  close() {
    this.closed = true;
  }
}

vi.stubGlobal('EventSource', FakeEventSource);
export { FakeEventSource };

afterEach(() => {
  cleanup();
  FakeEventSource.instances.length = 0;
  localStorage.clear();
  vi.restoreAllMocks();
});
