import { describe, expect, it } from 'vitest';
import {
  createLogger,
  createMetadataSyncEnvelope,
  redact,
  verifyMetadataSyncEnvelope,
} from './index.js';

describe('redact', () => {
  it('redacts secret-looking string values', () => {
    expect(redact('Bearer sk-abcdefghijklmnopqrstuvwxyz')).toContain('[REDACTED]');
    expect(redact('token sk-live-abcdefghijklmnop')).toContain('[REDACTED]');
    expect(redact('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')).toContain(
      '[REDACTED]',
    );
  });

  it('builds an allowlisted metadata-only sync envelope', () => {
    const record = {
      type: 'task' as const,
      taskId: 'task_1',
      projectId: 'project_1',
      state: 'VERIFYING',
      risk: 'high',
      updatedAt: '2026-07-28T12:00:00.000Z',
      sourceCode: 'do not upload',
      prompt: 'also do not upload',
    };
    const envelope = createMetadataSyncEnvelope({
      organisationId: 'org_1',
      installationId: 'installation_1',
      cursor: 'cursor_1',
      records: [record],
      createdAt: '2026-07-28T12:00:00.000Z',
    });
    expect(verifyMetadataSyncEnvelope(envelope)).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain('do not upload');
    expect(JSON.stringify(envelope)).not.toContain('prompt');
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
