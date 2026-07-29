import { readFileSync } from 'node:fs';
import { OsKeychainSecretStore } from '@roleflock/secret-store';
import { describe, expect, it } from 'vitest';
import {
  ChangePassportService,
  LocalRunnerIdentityService,
  parseChangePassportPayload,
  verifySignedChangePassport,
  type ChangePassportStore,
  type PassportRevocation,
  type RunnerIdentity,
  type RunnerIdentityStore,
  type StoredPassport,
} from './index.js';

const now = new Date('2026-07-28T10:00:00.000Z');

describe('Change Passport issue, verify, and revoke', () => {
  it('detects payload tampering, subject mismatch, and signed revocation', async () => {
    const fixture = setup();
    const payload = issuancePayload();
    const record = await fixture.service.issue(payload, evidence(payload));
    const identity = fixture.identities.getActiveLocal()!;

    const valid = verifySignedChangePassport({
      envelope: record.envelope,
      identity,
      expectedSubject: payload.subject,
      revocationSourceCurrent: true,
      now,
    });
    expect(valid).toMatchObject({
      cryptographicValidity: 'valid',
      identityStatus: 'trusted',
      subjectStatus: 'match',
      revocationStatus: 'current',
      accepted: true,
    });

    const decoded = JSON.parse(Buffer.from(record.envelope.payload, 'base64').toString('utf8')) as {
      subject: { resultCommit: string };
    };
    decoded.subject.resultCommit = '7'.repeat(40);
    const tampered = verifySignedChangePassport({
      envelope: {
        ...record.envelope,
        payload: Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64'),
      },
      identity,
      expectedSubject: payload.subject,
      revocationSourceCurrent: true,
      now,
    });
    expect(tampered.cryptographicValidity).toBe('invalid');
    expect(tampered.accepted).toBe(false);

    const mismatch = verifySignedChangePassport({
      envelope: record.envelope,
      identity,
      expectedSubject: { ...payload.subject, resultCommit: '8'.repeat(40) },
      revocationSourceCurrent: true,
      now,
    });
    expect(mismatch.subjectStatus).toBe('mismatch');
    expect(mismatch.accepted).toBe(false);

    const revocation = await fixture.service.revoke({
      passportId: payload.passportId,
      reason: 'Escaped defect invalidated the assurance claim.',
      revokedBy: 'authority_1',
    });
    const revoked = verifySignedChangePassport({
      envelope: record.envelope,
      identity,
      expectedSubject: payload.subject,
      revocation,
      revocationSourceCurrent: true,
      now,
    });
    expect(revoked.revocationStatus, revoked.errors.join(' | ')).toBe('revoked');
    expect(revoked.accepted).toBe(false);
  });

  it('refuses PASS issuance for stale or incomplete assurance', async () => {
    const fixture = setup();
    const payload = issuancePayload();
    await expect(
      fixture.service.issue(payload, {
        ...evidence(payload),
        currentPlanHash: '0'.repeat(64),
      }),
    ).rejects.toThrow(/stale contract, plan, or verification/);

    await expect(
      fixture.service.issue(
        {
          ...payload,
          passportId: 'passport_missing_evidence',
          verificationAttestations: [],
        },
        evidence(payload),
      ),
    ).rejects.toThrow(/attestation set is incomplete/);
  });
});

function setup() {
  const identities = new MemoryIdentityStore();
  const keychain = new FakeKeychain();
  const signer = new LocalRunnerIdentityService(
    identities,
    new OsKeychainSecretStore('dev.roleflock.runner', keychain),
    () => now,
  );
  const passports = new MemoryPassportStore();
  return {
    identities,
    passports,
    service: new ChangePassportService(passports, signer, () => now),
  };
}

function issuancePayload() {
  const source = fixture('passport-v1.json');
  const verificationDigest = String(
    (source.verificationSpecification as { digest: string }).digest,
  );
  return parseChangePassportPayload({
    ...source,
    approvals: (source.approvals as Array<Record<string, unknown>>).map((approval) => ({
      ...approval,
      artifactHashes: [...(approval.artifactHashes as string[]), verificationDigest],
    })),
  });
}

function evidence(payload: ReturnType<typeof issuancePayload>) {
  return {
    subject: payload.subject,
    currentContractHash: payload.contract.digest,
    currentPlanHash: payload.plan.digest,
    currentVerificationSpecificationHash: payload.verificationSpecification.digest,
    verificationDecision: {
      overallOutcome: 'pass' as const,
      resultCommit: payload.subject.resultCommit,
      attestationHashes: payload.verificationAttestations.map((item) => item.digest),
    },
    eventChainDigest: payload.eventChainDigest,
    terminalRun: true,
  };
}

class MemoryIdentityStore implements RunnerIdentityStore {
  identity?: RunnerIdentity;
  getActiveLocal() {
    return this.identity;
  }
  create(identity: RunnerIdentity) {
    this.identity = identity;
    return identity;
  }
}

class MemoryPassportStore implements ChangePassportStore {
  records = new Map<string, StoredPassport>();
  revocations = new Map<string, PassportRevocation>();
  create(record: StoredPassport) {
    this.records.set(record.passportId, record);
    return record;
  }
  get(passportId: string) {
    return this.records.get(passportId);
  }
  revoke(revocation: PassportRevocation) {
    this.revocations.set(revocation.passportId, revocation);
    return revocation;
  }
  getRevocation(passportId: string) {
    return this.revocations.get(passportId);
  }
}

class FakeKeychain {
  values = new Map<string, string>();
  async getPassword(service: string, account: string) {
    return this.values.get(`${service}:${account}`) ?? null;
  }
  async setPassword(service: string, account: string, value: string) {
    this.values.set(`${service}:${account}`, value);
  }
  async deletePassword(service: string, account: string) {
    return this.values.delete(`${service}:${account}`);
  }
}

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>;
}
