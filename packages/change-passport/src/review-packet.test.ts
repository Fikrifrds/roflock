import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildReviewPacket, parseChangePassportPayload, type RunnerIdentity } from './index.js';

describe('Change Passport review packet', () => {
  it('labels local self-attestation without implying organisation trust', () => {
    const payload = parseChangePassportPayload(fixture());
    const packet = buildReviewPacket({
      payload,
      issuerIdentity: identity('local_installation'),
      decision: {
        verdicts: [
          {
            criterionId: 'AC-1',
            outcome: 'pass',
            evidenceRefs: ['attestation_fixture_1'],
            explanation: 'Independent deterministic evidence passed.',
          },
        ],
      },
    });

    expect(packet.assurance).toMatchObject({
      issuerTrust: 'local_self',
      issuerTrustLabel: 'Local self-attestation',
      verification: 'clean_local_runner',
    });
    expect(packet.caveats.join(' ')).toMatch(
      /workstation owner remains inside the trust boundary/i,
    );
    expect(packet.criteria).toMatchObject([
      { criterionId: 'AC-1', outcome: 'pass', evidenceCount: 1 },
    ]);
  });

  it('uses a distinct organisation-trusted label', () => {
    const source = fixture();
    const payload = parseChangePassportPayload({
      ...source,
      assurance: {
        ...(source.assurance as Record<string, unknown>),
        issuerTrust: 'organisation',
        verification: 'organisation_trusted_runner',
      },
    });
    const packet = buildReviewPacket({
      payload,
      issuerIdentity: identity('organisation_runner'),
    });
    expect(packet.assurance.issuerTrustLabel).toBe('Organisation-trusted attestation');
    expect(packet.caveats.join(' ')).not.toMatch(/workstation owner/);
  });
});

function identity(kind: RunnerIdentity['kind']): RunnerIdentity {
  return {
    id: `runner_${kind}`,
    kind,
    algorithm: 'ed25519',
    keyId: 'a'.repeat(64),
    keyReference: `keychain.${kind}`,
    publicKey: '-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----',
    validFrom: '2026-07-28T10:00:00.000Z',
    status: 'active',
  };
}

function fixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL('../fixtures/passport-v1.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
}
