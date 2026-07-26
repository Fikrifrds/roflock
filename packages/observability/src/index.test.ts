import { describe, expect, it } from 'vitest';
import { createLogger, redact } from './index.js';

describe('redact', () => {
  it('redacts secret-looking string values', () => {
    expect(redact('Bearer sk-abcdefghijklmnopqrstuvwxyz')).toContain('[REDACTED]');
    expect(redact('token sk-live-abcdefghijklmnop')).toContain('[REDACTED]');
    expect(redact('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')).toContain(
      '[REDACTED]',
    );
  });

  it('redacts sensitive object keys', () => {
    const result = redact({
      apiKey: 'secret-value',
      authorization: 'Bearer xyz',
      nested: { password: 'hunter2', title: 'ok' },
      brief: 'safe text',
    }) as Record<string, unknown>;
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.authorization).toBe('[REDACTED]');
    expect((result.nested as Record<string, unknown>).password).toBe('[REDACTED]');
    expect((result.nested as Record<string, unknown>).title).toBe('ok');
    expect(result.brief).toBe('safe text');
  });

  it('redacts logger fields before write', () => {
    const entries: unknown[] = [];
    const logger = createLogger({}, (entry) => entries.push(entry));
    logger.info('provider call', { api_key: 'sk-abcdefghijklmnopqrst', note: 'ok' });
    const entry = entries[0] as Record<string, unknown>;
    expect(entry.api_key).toBe('[REDACTED]');
    expect(entry.note).toBe('ok');
  });
});
