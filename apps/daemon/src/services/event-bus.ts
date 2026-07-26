import { randomUUID } from 'node:crypto';

export interface RuntimeEvent {
  id: string;
  type: string;
  data: unknown;
  at: string;
}

export class EventBus {
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();

  publish(type: string, data: unknown): RuntimeEvent {
    const event = { id: randomUUID(), type, data, at: new Date().toISOString() };
    for (const listener of this.listeners) listener(event);
    return event;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
