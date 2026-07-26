import { createHash, randomBytes } from 'node:crypto';

export function createId(prefix = 'rf'): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(8).toString('hex');
  return `${prefix}_${ts}_${rand}`;
}

export function createIdempotencyKey(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

export function sha256Canonical(value: unknown): string {
  const canonical = canonicalize(value);
  return createHash('sha256').update(canonical).digest('hex');
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortValue(obj[key]);
    }
    return sorted;
  }
  return value;
}

export interface Clock {
  now(): Date;
  nowIso(): string;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  nowIso(): string {
    return this.now().toISOString();
  }
}

export class FakeClock implements Clock {
  constructor(private current: Date = new Date('2026-07-26T00:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = new Date(date);
  }
}
