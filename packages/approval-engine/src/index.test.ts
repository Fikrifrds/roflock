import { describe, expect, it } from 'vitest';
import {
  actionFingerprint,
  appendTransparencyEntry,
  evaluateMultiPartyApproval,
  verifyTransparencyLog,
} from './index.js';
describe('actionFingerprint', () => {
  it('canonicalises object keys and path ordering', () => {
    expect(
      actionFingerprint({
        kind: 'file',
        verb: 'write',
        paths: ['b.ts', 'a.ts'],
        metadata: { b: 2, a: 1 },
      }),
    ).toBe(
      actionFingerprint({
        verb: 'write',
        kind: 'file',
        paths: ['a.ts', 'b.ts'],
        metadata: { a: 1, b: 2 },
      }),
    );
  });
});

describe('multi-party approval and transparency', () => {
  it('requires distinct actors, quorum, role coverage, and honours vetoes', () => {
    const policy = {
      id: 'policy_1',
      artifactDigest: 'a'.repeat(64),
      quorum: 2,
      requiredRoles: ['security', 'owner'],
      vetoRoles: ['security'],
    };
    const decisions = [
      {
        actorId: 'actor_1',
        role: 'security',
        decision: 'approved' as const,
        artifactDigest: 'a'.repeat(64),
        signatureDigest: '1'.repeat(64),
      },
      {
        actorId: 'actor_2',
        role: 'owner',
        decision: 'approved' as const,
        artifactDigest: 'a'.repeat(64),
        signatureDigest: '2'.repeat(64),
      },
    ];
    expect(evaluateMultiPartyApproval(policy, decisions)).toMatchObject({
      outcome: 'approved',
      approvals: 2,
    });
    expect(
      evaluateMultiPartyApproval(policy, [
        ...decisions,
        { ...decisions[0]!, decision: 'rejected' as const },
      ]),
    ).toMatchObject({ outcome: 'rejected' });
  });

  it('detects transparency log tampering', () => {
    const first = appendTransparencyEntry(undefined, {
      entryType: 'approval.decided',
      subjectId: 'artifact_1',
      payloadDigest: 'a'.repeat(64),
      occurredAt: '2026-07-28T12:00:00.000Z',
    });
    const second = appendTransparencyEntry(first, {
      entryType: 'approval.decided',
      subjectId: 'artifact_1',
      payloadDigest: 'b'.repeat(64),
      occurredAt: '2026-07-28T12:01:00.000Z',
    });
    expect(verifyTransparencyLog([first, second])).toBe(true);
    expect(verifyTransparencyLog([first, { ...second, payloadDigest: 'c'.repeat(64) }])).toBe(
      false,
    );
  });
});
