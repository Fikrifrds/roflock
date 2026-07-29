import { canonicalize, sha256Canonical } from '@roleflock/contracts';
import { z } from 'zod';

export const CHANGE_PASSPORT_SCHEMA_VERSION = '1.0.0';
export const CHANGE_PASSPORT_PAYLOAD_TYPE =
  'application/vnd.roleflock.change-passport+json;version=1';

const IdentifierSchema = z.string().trim().min(1).max(240);
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const CommitSchema = z.string().regex(/^[a-f0-9]{7,64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const SemverSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const Base64Schema = z.string().refine(isCanonicalBase64, 'Expected canonical base64');

export const PassportSubjectSchema = z
  .object({
    repositoryId: IdentifierSchema,
    repositoryRemoteDigest: DigestSchema.optional(),
    baseCommit: CommitSchema,
    resultCommit: CommitSchema,
    treeDigest: DigestSchema,
    diffDigest: DigestSchema,
  })
  .passthrough();
export type PassportSubject = z.infer<typeof PassportSubjectSchema>;

export const ArtifactDigestReferenceSchema = z
  .object({
    id: IdentifierSchema,
    kind: IdentifierSchema,
    digest: DigestSchema,
    digestAlgorithm: z.literal('sha256'),
    availability: z.enum(['embedded', 'external', 'digest_only', 'unavailable']),
    locator: z.string().trim().min(1).optional(),
  })
  .passthrough();

export const AttestationReferenceSchema = z
  .object({
    id: IdentifierSchema,
    digest: DigestSchema,
    kind: IdentifierSchema,
    outcome: z.enum(['pass', 'fail', 'error', 'timeout', 'unknown']),
    runnerIdentityId: IdentifierSchema,
    availability: z.enum(['embedded', 'external', 'digest_only', 'unavailable']),
    locator: z.string().trim().min(1).optional(),
  })
  .passthrough();

export const PolicyDecisionReferenceSchema = z
  .object({
    id: IdentifierSchema,
    digest: DigestSchema,
    predicate: IdentifierSchema,
    outcome: z.enum(['pass', 'fail', 'waived', 'unknown']),
    required: z.boolean(),
  })
  .passthrough();

export const ApprovalReferenceSchema = z
  .object({
    id: IdentifierSchema,
    digest: DigestSchema,
    actorId: IdentifierSchema,
    decision: z.enum(['approved', 'rejected', 'waived']),
    artifactHashes: z.array(DigestSchema),
    resultCommit: CommitSchema,
  })
  .passthrough();

export const DisclosureManifestReferenceSchema = z
  .object({
    id: IdentifierSchema,
    digest: DigestSchema,
    view: z.enum(['internal', 'client', 'public']),
    redacted: z.boolean(),
  })
  .passthrough();

export const DeviationReferenceSchema = z
  .object({
    id: IdentifierSchema,
    digest: DigestSchema,
    status: z.enum(['open', 'resolved_by_plan_revision', 'rejected', 'waived']),
    blocking: z.boolean(),
  })
  .passthrough();

export const RiskRecordSchema = z
  .object({
    id: IdentifierSchema,
    summary: z.string().trim().min(1),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    status: z.enum(['open', 'accepted', 'mitigated']),
    blocking: z.boolean(),
    acceptedBy: IdentifierSchema.optional(),
  })
  .passthrough();

export const AssurancePropertiesSchema = z
  .object({
    intent: z.enum(['authorised', 'draft', 'legacy_uncontracted']),
    plan: z.enum(['approved', 'unapproved', 'absent']),
    execution: z.enum(['roleflock_managed', 'external_observed', 'external_incomplete']),
    verification: z.enum([
      'executor_claim_only',
      'clean_local_runner',
      'organisation_trusted_runner',
      'external_attested_runner',
    ]),
    verifierIndependence: z.array(
      z.enum([
        'separate_invocation',
        'different_model',
        'different_model_family',
        'different_provider',
        'clean_workspace',
        'separate_credentials',
      ]),
    ),
    issuerTrust: z.enum(['local_self', 'organisation', 'external']),
    evidenceAvailability: z.enum(['complete', 'partial', 'digest_only']),
  })
  .passthrough();

export const ChangePassportPayloadSchema = z
  .object({
    schemaVersion: SemverSchema,
    passportId: IdentifierSchema,
    taskId: IdentifierSchema,
    subject: PassportSubjectSchema,
    contract: ArtifactDigestReferenceSchema,
    plan: ArtifactDigestReferenceSchema,
    verificationSpecification: ArtifactDigestReferenceSchema,
    executionAttestations: z.array(AttestationReferenceSchema),
    verificationAttestations: z.array(AttestationReferenceSchema),
    policyDecisions: z.array(PolicyDecisionReferenceSchema),
    approvals: z.array(ApprovalReferenceSchema),
    disclosures: z.array(DisclosureManifestReferenceSchema),
    deviations: z.array(DeviationReferenceSchema),
    unresolvedRisks: z.array(RiskRecordSchema),
    eventChainDigest: DigestSchema,
    verdict: z.enum(['pass', 'fail', 'conditional', 'revoked']),
    assurance: AssurancePropertiesSchema,
    issuedAt: TimestampSchema,
    expiresAt: TimestampSchema.optional(),
  })
  .passthrough()
  .superRefine((payload, context) => {
    if (payload.expiresAt && Date.parse(payload.expiresAt) <= Date.parse(payload.issuedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'Passport expiry must be after issuance',
      });
    }
    if (
      payload.verdict === 'pass' &&
      (payload.assurance.intent !== 'authorised' || payload.assurance.plan !== 'approved')
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['verdict'],
        message: 'PASS requires authorised intent and an approved plan',
      });
    }
  });
export type ChangePassportPayload = z.infer<typeof ChangePassportPayloadSchema>;

export const SignedChangePassportSchema = z
  .object({
    payloadType: z.string().trim().min(1),
    payload: Base64Schema,
    signatures: z.array(
      z
        .object({
          keyid: IdentifierSchema,
          sig: Base64Schema,
          algorithm: z.literal('ed25519'),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type SignedChangePassport = z.infer<typeof SignedChangePassportSchema>;

export const KNOWN_POLICY_PREDICATES = new Set([
  'contract_authorised',
  'plan_approved',
  'subject_match',
  'criteria_pass',
  'required_evidence_present',
  'no_blocking_deviation',
  'verification_independence',
  'approval_binding',
  'event_chain_valid',
]);

export function parseChangePassportPayload(
  input: unknown,
  options: {
    supportedVersion?: string;
    knownPolicyPredicates?: ReadonlySet<string>;
  } = {},
): ChangePassportPayload {
  const payload = ChangePassportPayloadSchema.parse(input);
  assertCompatibleVersion(payload.schemaVersion, options.supportedVersion);
  const known = options.knownPolicyPredicates ?? KNOWN_POLICY_PREDICATES;
  const unknownRequired = payload.policyDecisions.find(
    (decision) => decision.required && !known.has(decision.predicate),
  );
  if (unknownRequired) {
    throw new Error(`Unknown required policy predicate: ${unknownRequired.predicate}`);
  }
  return payload;
}

export function assertCompatibleVersion(
  version: string,
  supportedVersion = CHANGE_PASSPORT_SCHEMA_VERSION,
): void {
  const requested = parseVersion(version);
  const supported = parseVersion(supportedVersion);
  if (requested.major !== supported.major) {
    throw new Error(
      `Unsupported Change Passport major version ${requested.major}; supported major is ${supported.major}`,
    );
  }
}

export function encodeChangePassportPayload(payload: ChangePassportPayload): string {
  const parsed = parseChangePassportPayload(payload);
  return Buffer.from(canonicalize(parsed), 'utf8').toString('base64');
}

export function decodeChangePassportPayload(envelope: SignedChangePassport): ChangePassportPayload {
  const parsedEnvelope = SignedChangePassportSchema.parse(envelope);
  if (parsedEnvelope.payloadType !== CHANGE_PASSPORT_PAYLOAD_TYPE) {
    throw new Error(`Unsupported Change Passport payload type: ${parsedEnvelope.payloadType}`);
  }
  const decoded = JSON.parse(Buffer.from(parsedEnvelope.payload, 'base64').toString('utf8'));
  return parseChangePassportPayload(decoded);
}

export function changePassportPayloadDigest(payload: ChangePassportPayload): string {
  return sha256Canonical(parseChangePassportPayload(payload));
}

function parseVersion(version: string): { major: number; minor: number; patch: number } {
  const match = SemverSchema.safeParse(version);
  if (!match.success) throw new Error(`Invalid Change Passport schema version: ${version}`);
  const [major, minor, patch] = match.data.split('.').map(Number);
  return { major: major!, minor: minor!, patch: patch! };
}

function isCanonicalBase64(value: string): boolean {
  try {
    return Buffer.from(value, 'base64').toString('base64') === value;
  } catch {
    return false;
  }
}

export * from './signing.js';
export * from './service.js';
