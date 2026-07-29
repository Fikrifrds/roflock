import { verify as verifyBytes } from 'node:crypto';
import { canonicalize, sha256Canonical } from '@roleflock/contracts';
import { z } from 'zod';
import {
  CHANGE_PASSPORT_PAYLOAD_TYPE,
  SignedChangePassportSchema,
  changePassportPayloadDigest,
  decodeChangePassportPayload,
  parseChangePassportPayload,
  type ChangePassportPayload,
  type PassportSubject,
  type SignedChangePassport,
} from './index.js';
import {
  LocalRunnerIdentityService,
  RunnerIdentitySchema,
  dssePreAuthenticationEncoding,
  publicKeyObject,
  type RunnerIdentity,
} from './signing.js';

export const PASSPORT_REVOCATION_PAYLOAD_TYPE =
  'application/vnd.roleflock.change-passport-revocation+json;version=1';

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

const PassportRevocationContentSchema = z
  .object({
    passportId: z.string().trim().min(1),
    payloadDigest: DigestSchema,
    reason: z.string().trim().min(1),
    revokedBy: z.string().trim().min(1),
    revokedAt: TimestampSchema,
  })
  .strict();

export const PassportRevocationSchema = z
  .object({
    ...PassportRevocationContentSchema.shape,
    signature: z.lazy(() => SignedChangePassportSchema),
  })
  .strict();
export type PassportRevocation = z.infer<typeof PassportRevocationSchema>;

export interface StoredPassport {
  passportId: string;
  taskId: string;
  resultCommit: string;
  payloadDigest: string;
  issuerIdentityId: string;
  verdict: ChangePassportPayload['verdict'];
  envelope: SignedChangePassport;
  issuedAt: string;
}

export interface ChangePassportStore {
  create(record: StoredPassport): StoredPassport;
  get(passportId: string): StoredPassport | undefined;
  revoke(revocation: PassportRevocation): PassportRevocation;
  getRevocation(passportId: string): PassportRevocation | undefined;
}

export interface PassportIssuanceEvidence {
  subject: PassportSubject;
  currentContractHash: string;
  currentPlanHash: string;
  currentVerificationSpecificationHash: string;
  verificationDecision: {
    overallOutcome: 'pass' | 'fail' | 'insufficient_evidence';
    resultCommit: string;
    attestationHashes: string[];
  };
  eventChainDigest: string;
  terminalRun: boolean;
}

export class ChangePassportService {
  constructor(
    private readonly passports: ChangePassportStore,
    private readonly signer: LocalRunnerIdentityService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(
    payloadInput: ChangePassportPayload,
    evidence: PassportIssuanceEvidence,
  ): Promise<StoredPassport> {
    const payload = parseChangePassportPayload(payloadInput);
    if (this.passports.get(payload.passportId)) {
      throw new Error(`Change Passport already exists: ${payload.passportId}`);
    }
    assertIssuancePolicy(payload, evidence);
    const { identity, envelope } = await this.signer.sign(payload);
    assertIssuerTrust(payload, identity);
    return this.passports.create({
      passportId: payload.passportId,
      taskId: payload.taskId,
      resultCommit: payload.subject.resultCommit,
      payloadDigest: changePassportPayloadDigest(payload),
      issuerIdentityId: identity.id,
      verdict: payload.verdict,
      envelope,
      issuedAt: payload.issuedAt,
    });
  }

  async revoke(input: {
    passportId: string;
    reason: string;
    revokedBy: string;
  }): Promise<PassportRevocation> {
    const passport = this.passports.get(input.passportId);
    if (!passport) throw new Error(`Change Passport not found: ${input.passportId}`);
    if (this.passports.getRevocation(input.passportId)) {
      throw new Error(`Change Passport is already revoked: ${input.passportId}`);
    }
    const content = PassportRevocationContentSchema.parse({
      passportId: passport.passportId,
      payloadDigest: passport.payloadDigest,
      reason: input.reason,
      revokedBy: input.revokedBy,
      revokedAt: this.now().toISOString(),
    });
    const { envelope } = await this.signer.signEnvelope(
      PASSPORT_REVOCATION_PAYLOAD_TYPE,
      Buffer.from(canonicalize(content), 'utf8'),
    );
    return this.passports.revoke(
      PassportRevocationSchema.parse({ ...content, signature: envelope }),
    );
  }
}

export type PassportVerificationResult = {
  cryptographicValidity: 'valid' | 'invalid';
  identityStatus: 'trusted' | 'key_mismatch' | 'not_yet_valid' | 'expired' | 'revoked';
  subjectStatus: 'match' | 'mismatch' | 'not_checked';
  expiryStatus: 'current' | 'expired' | 'not_set';
  revocationStatus: 'current' | 'revoked' | 'unknown';
  payload?: ChangePassportPayload;
  accepted: boolean;
  errors: string[];
};

export function verifySignedChangePassport(input: {
  envelope: SignedChangePassport;
  identity: RunnerIdentity;
  expectedSubject?: PassportSubject;
  revocation?: PassportRevocation;
  revocationSourceCurrent?: boolean;
  now?: Date;
}): PassportVerificationResult {
  const errors: string[] = [];
  const now = input.now ?? new Date();
  const identity = RunnerIdentitySchema.parse(input.identity);
  let payload: ChangePassportPayload | undefined;
  let cryptographicValidity: PassportVerificationResult['cryptographicValidity'] = 'invalid';
  try {
    const envelope = SignedChangePassportSchema.parse(input.envelope);
    payload = decodeChangePassportPayload(envelope);
    const signature = envelope.signatures.find((item) => item.keyid === identity.keyId);
    if (
      signature &&
      envelope.payloadType === CHANGE_PASSPORT_PAYLOAD_TYPE &&
      verifyBytes(
        null,
        dssePreAuthenticationEncoding(envelope.payloadType, envelope.payload),
        publicKeyObject(identity),
        Buffer.from(signature.sig, 'base64'),
      )
    ) {
      cryptographicValidity = 'valid';
    } else {
      errors.push('Passport signature is invalid or key identity does not match');
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Passport payload is invalid');
  }

  const identityStatus = evaluateIdentity(identity, payload?.issuedAt, now);
  if (identityStatus !== 'trusted') errors.push(`Runner identity is ${identityStatus}`);
  const subjectStatus = input.expectedSubject
    ? payload &&
      sha256Canonical(PassportSubjectSchemaForComparison.parse(payload.subject)) ===
        sha256Canonical(PassportSubjectSchemaForComparison.parse(input.expectedSubject))
      ? 'match'
      : 'mismatch'
    : 'not_checked';
  if (subjectStatus === 'mismatch') errors.push('Passport subject does not match');
  const expiryStatus = payload?.expiresAt
    ? now.getTime() >= Date.parse(payload.expiresAt)
      ? 'expired'
      : 'current'
    : 'not_set';
  if (expiryStatus === 'expired') errors.push('Passport is expired');
  const revocationVerification = input.revocation
    ? verifyRevocation(input.revocation, identity, payload)
    : undefined;
  const revocationStatus = input.revocation
    ? revocationVerification?.valid
      ? 'revoked'
      : 'unknown'
    : input.revocationSourceCurrent
      ? 'current'
      : 'unknown';
  if (revocationStatus === 'revoked') errors.push('Passport is revoked');
  if (revocationStatus === 'unknown') errors.push('Passport revocation status is unknown');
  if (input.revocation && revocationStatus === 'unknown') {
    errors.push(revocationVerification?.error ?? 'Revocation record is invalid');
  }
  if (payload && payload.verdict !== 'pass') {
    errors.push(`Passport verdict is ${payload.verdict}, not pass`);
  }

  return {
    cryptographicValidity,
    identityStatus,
    subjectStatus,
    expiryStatus,
    revocationStatus,
    ...(payload ? { payload } : {}),
    accepted:
      cryptographicValidity === 'valid' &&
      identityStatus === 'trusted' &&
      subjectStatus === 'match' &&
      expiryStatus !== 'expired' &&
      revocationStatus === 'current' &&
      payload?.verdict === 'pass',
    errors,
  };
}

function assertIssuancePolicy(
  payload: ChangePassportPayload,
  evidence: PassportIssuanceEvidence,
): void {
  if (
    sha256Canonical(payload.subject) !== sha256Canonical(evidence.subject) ||
    payload.subject.resultCommit !== evidence.verificationDecision.resultCommit
  ) {
    throw new Error('Passport subject does not match execution and verification');
  }
  if (
    payload.contract.digest !== evidence.currentContractHash ||
    payload.plan.digest !== evidence.currentPlanHash ||
    payload.verificationSpecification.digest !== evidence.currentVerificationSpecificationHash
  ) {
    throw new Error('Passport references a stale contract, plan, or verification specification');
  }
  if (payload.eventChainDigest !== evidence.eventChainDigest) {
    throw new Error('Passport event chain digest is stale');
  }
  if (!evidence.terminalRun) throw new Error('Passport cannot issue before the run is terminal');
  if (payload.verdict !== 'pass') return;
  if (evidence.verificationDecision.overallOutcome !== 'pass') {
    throw new Error('PASS passport requires all acceptance criteria to pass');
  }
  const passportAttestations = payload.verificationAttestations.map((item) => item.digest).sort();
  if (
    JSON.stringify(passportAttestations) !==
    JSON.stringify([...evidence.verificationDecision.attestationHashes].sort())
  ) {
    throw new Error('PASS passport verification attestation set is incomplete');
  }
  if (
    [
      payload.contract,
      payload.plan,
      payload.verificationSpecification,
      ...payload.verificationAttestations,
    ].some((item) => item.availability === 'unavailable' || item.availability === 'digest_only')
  ) {
    throw new Error('PASS passport requires inspectable mandatory evidence');
  }
  if (
    payload.policyDecisions.some((decision) => decision.required && decision.outcome !== 'pass')
  ) {
    throw new Error('PASS passport has an unsatisfied required policy');
  }
  if (
    payload.deviations.some((deviation) => deviation.blocking && deviation.status === 'open') ||
    payload.unresolvedRisks.some((risk) => risk.blocking && risk.status === 'open')
  ) {
    throw new Error('PASS passport has an open blocking deviation or risk');
  }
  const approvalHashes = new Set([
    payload.contract.digest,
    payload.plan.digest,
    payload.verificationSpecification.digest,
  ]);
  if (
    !payload.approvals.some(
      (approval) =>
        approval.decision === 'approved' &&
        approval.resultCommit === payload.subject.resultCommit &&
        [...approvalHashes].every((hash) => approval.artifactHashes.includes(hash)),
    )
  ) {
    throw new Error('PASS passport lacks an approval bound to current artifacts and result commit');
  }
}

function assertIssuerTrust(payload: ChangePassportPayload, identity: RunnerIdentity): void {
  const expected =
    identity.kind === 'local_installation'
      ? 'local_self'
      : identity.kind === 'organisation_runner'
        ? 'organisation'
        : 'external';
  if (payload.assurance.issuerTrust !== expected) {
    throw new Error(`Passport issuer trust claim does not match runner identity: ${expected}`);
  }
}

function evaluateIdentity(
  identity: RunnerIdentity,
  issuedAt: string | undefined,
  now: Date,
): PassportVerificationResult['identityStatus'] {
  if (identity.status === 'revoked') return 'revoked';
  const reference = issuedAt ? Date.parse(issuedAt) : now.getTime();
  if (reference < Date.parse(identity.validFrom)) return 'not_yet_valid';
  if (identity.validUntil && reference >= Date.parse(identity.validUntil)) return 'expired';
  return 'trusted';
}

function verifyRevocation(
  revocationInput: PassportRevocation,
  identity: RunnerIdentity,
  payload: ChangePassportPayload | undefined,
): { valid: boolean; error?: string } {
  if (!payload) return { valid: false, error: 'Revocation has no valid passport payload' };
  const revocation = PassportRevocationSchema.parse(revocationInput);
  if (revocation.passportId !== payload.passportId) {
    return { valid: false, error: 'Revocation passport identity does not match' };
  }
  if (revocation.payloadDigest !== changePassportPayloadDigest(payload)) {
    return { valid: false, error: 'Revocation payload digest does not match' };
  }
  if (revocation.signature.payloadType !== PASSPORT_REVOCATION_PAYLOAD_TYPE) {
    return { valid: false, error: 'Revocation payload type does not match' };
  }
  const signature = revocation.signature.signatures.find((item) => item.keyid === identity.keyId);
  if (!signature) return { valid: false, error: 'Revocation signing key does not match' };
  const { signature: _signature, ...content } = revocation;
  if (
    Buffer.from(revocation.signature.payload, 'base64').toString('utf8') !== canonicalize(content)
  ) {
    return { valid: false, error: 'Revocation signed content does not match its record' };
  }
  const valid = verifyBytes(
    null,
    dssePreAuthenticationEncoding(revocation.signature.payloadType, revocation.signature.payload),
    publicKeyObject(identity),
    Buffer.from(signature.sig, 'base64'),
  );
  return valid
    ? { valid: true }
    : { valid: false, error: 'Revocation signature is cryptographically invalid' };
}

const PassportSubjectSchemaForComparison = z
  .object({
    repositoryId: z.string(),
    repositoryRemoteDigest: DigestSchema.optional(),
    baseCommit: z.string(),
    resultCommit: z.string(),
    treeDigest: DigestSchema,
    diffDigest: DigestSchema,
  })
  .passthrough();
