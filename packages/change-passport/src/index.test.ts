import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHANGE_PASSPORT_PAYLOAD_TYPE,
  assertCompatibleVersion,
  changePassportPayloadDigest,
  decodeChangePassportPayload,
  encodeChangePassportPayload,
  parseChangePassportPayload,
} from './index.js';

describe('Change Passport v1 schema compatibility', () => {
  it('validates the golden v1 fixture with a stable canonical digest', () => {
    const payload = parseChangePassportPayload(fixture('passport-v1.json'));
    expect(payload.schemaVersion).toBe('1.0.0');
    expect(changePassportPayloadDigest(payload)).toBe(
      '332e3911b1ce45390a0f37d8c0c3b77d0eda18e2b2004946c8342adee822b162',
    );

    const encoded = encodeChangePassportPayload(payload);
    expect(
      decodeChangePassportPayload({
        payloadType: CHANGE_PASSPORT_PAYLOAD_TYPE,
        payload: encoded,
        signatures: [],
      }),
    ).toEqual(payload);
  });

  it('preserves unknown optional fields from a compatible minor version', () => {
    const payload = parseChangePassportPayload(fixture('passport-v1.1-forward.json'));
    expect(payload.schemaVersion).toBe('1.1.0');
    expect(payload.futureOptionalField).toEqual({ preserved: true });
    expect(payload.subject.futureSubjectHint).toBe('preserve-me');
    expect(
      decodeChangePassportPayload({
        payloadType: CHANGE_PASSPORT_PAYLOAD_TYPE,
        payload: encodeChangePassportPayload(payload),
        signatures: [],
      }),
    ).toEqual(payload);
  });

  it('rejects unknown major versions and unknown required policy predicates', () => {
    expect(() => assertCompatibleVersion('2.0.0')).toThrow(/Unsupported.*major version/);
    const fixturePayload = fixture('passport-v1.json');
    expect(() =>
      parseChangePassportPayload({
        ...fixturePayload,
        policyDecisions: [
          {
            id: 'policy_future',
            digest: 'a'.repeat(64),
            predicate: 'future_unrecognised_gate',
            outcome: 'pass',
            required: true,
          },
        ],
      }),
    ).toThrow(/Unknown required policy predicate/);

    expect(
      parseChangePassportPayload({
        ...fixturePayload,
        policyDecisions: [
          {
            id: 'policy_future',
            digest: 'a'.repeat(64),
            predicate: 'future_optional_observation',
            outcome: 'unknown',
            required: false,
          },
        ],
      }).policyDecisions,
    ).toHaveLength(1);
  });
});

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
}
