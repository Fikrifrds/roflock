import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildReviewPacket,
  parseChangePassportPayload,
  renderGitHubReviewPacket,
  type RunnerIdentity,
} from './index.js';

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

  it('discloses a signing key that is only protected by a local file', () => {
    const packet = buildReviewPacket({
      payload: parseChangePassportPayload(fixture()),
      issuerIdentity: identity('local_installation'),
      keyProtection: 'local_file',
    });
    expect(packet.caveats.join(' ')).toMatch(/local encrypted file whose key sits beside it/i);
  });

  it('adds no key-protection caveat once the key is in an OS keychain', () => {
    const packet = buildReviewPacket({
      payload: parseChangePassportPayload(fixture()),
      issuerIdentity: identity('local_installation'),
      keyProtection: 'os_keychain',
    });
    expect(packet.caveats.join(' ')).not.toMatch(/signing key/i);
  });

  it('says key protection is unstated rather than implying the stronger case', () => {
    const packet = buildReviewPacket({
      payload: parseChangePassportPayload(fixture()),
      issuerIdentity: identity('local_installation'),
    });
    expect(packet.caveats.join(' ')).toMatch(/protection is not stated/i);
  });

  it('renders a commit-bound GitHub review packet', () => {
    const payload = parseChangePassportPayload(fixture());
    const markdown = renderGitHubReviewPacket(
      buildReviewPacket({
        payload,
        issuerIdentity: identity('local_installation'),
      }),
    );
    expect(markdown).toContain(`Passport: \`${payload.passportId}\``);
    expect(markdown).toContain(`Commit: \`${payload.subject.resultCommit}\``);
    expect(markdown).toContain('valid only for the exact commit');
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
