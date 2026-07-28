import { sha256Canonical } from '@roleflock/contracts';
import {
  ActorReferenceSchema,
  InvocationReferenceSchema,
  type ChangeContract,
  type ExecutionPlan,
} from '@roleflock/change-contracts';
import { z } from 'zod';

const IdentifierSchema = z.string().trim().min(1).max(160);
const NonEmptyTextSchema = z.string().trim().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const RelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.startsWith('/') && !value.split('/').includes('..'));

const CheckBase = {
  id: IdentifierSchema,
  criterionIds: z.array(IdentifierSchema).min(1),
  required: z.boolean(),
  description: NonEmptyTextSchema,
} as const;

export const CommandVerificationCheckSchema = z
  .object({
    ...CheckBase,
    kind: z.enum(['command', 'static_analysis', 'security_scan']),
    argv: z.array(NonEmptyTextSchema).min(1).max(128),
    cwd: RelativePathSchema.optional(),
    timeoutMs: z.number().int().positive().max(3_600_000),
    expectedExitCodes: z.array(z.number().int().min(0).max(255)).min(1),
  })
  .strict();

export const AssertionVerificationCheckSchema = z
  .object({
    ...CheckBase,
    kind: z.enum(['test_selector', 'schema_assertion', 'browser_assertion', 'database_assertion']),
    target: NonEmptyTextSchema,
    assertion: NonEmptyTextSchema,
  })
  .strict();

export const DiffPolicyVerificationCheckSchema = z
  .object({
    ...CheckBase,
    kind: z.literal('diff_policy'),
    protectedPaths: z.array(RelativePathSchema),
    forbiddenPaths: z.array(RelativePathSchema),
    maxChangedFiles: z.number().int().positive().optional(),
  })
  .strict();

export const ManualVerificationCheckSchema = z
  .object({
    ...CheckBase,
    kind: z.literal('manual_review'),
    instructions: NonEmptyTextSchema,
    authorityRole: z.enum(['verifier', 'release_approver', 'human']),
  })
  .strict();

export const VerificationCheckSchema = z.discriminatedUnion('kind', [
  CommandVerificationCheckSchema,
  AssertionVerificationCheckSchema,
  DiffPolicyVerificationCheckSchema,
  ManualVerificationCheckSchema,
]);
export type VerificationCheck = z.infer<typeof VerificationCheckSchema>;

export const VerificationEnvironmentSchema = z
  .object({
    platform: NonEmptyTextSchema,
    architecture: NonEmptyTextSchema,
    requiredTools: z.array(
      z
        .object({
          name: IdentifierSchema,
          versionConstraint: NonEmptyTextSchema,
        })
        .strict(),
    ),
    network: z.enum(['deny', 'allowlist']),
    networkAllowlist: z.array(NonEmptyTextSchema),
    environmentVariableAllowlist: z.array(IdentifierSchema),
    credentialProfileId: IdentifierSchema,
  })
  .strict()
  .superRefine((environment, context) => {
    if (environment.network === 'deny' && environment.networkAllowlist.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A network-denied environment cannot contain an allowlist',
        path: ['networkAllowlist'],
      });
    }
  });
export type VerificationEnvironment = z.infer<typeof VerificationEnvironmentSchema>;

export const VerificationEvidenceRequirementSchema = z
  .object({
    id: IdentifierSchema,
    criterionId: IdentifierSchema,
    evidenceType: z.enum([
      'command_result',
      'test_result',
      'static_analysis',
      'security_scan',
      'browser_capture',
      'database_observation',
      'diff_observation',
      'manual_attestation',
    ]),
    minimumCount: z.number().int().positive(),
    mandatory: z.boolean(),
  })
  .strict();
export type VerificationEvidenceRequirement = z.infer<typeof VerificationEvidenceRequirementSchema>;

export const TestMutationPolicySchema = z.enum(['forbid', 'review', 'allow_planned']);
export type TestMutationPolicy = z.infer<typeof TestMutationPolicySchema>;

const VerificationSpecificationFields = {
  id: IdentifierSchema,
  taskId: IdentifierSchema,
  contractHash: Sha256Schema,
  planId: IdentifierSchema,
  planHash: Sha256Schema,
  version: z.number().int().positive(),
  status: z.literal('approved'),
  checks: z.array(VerificationCheckSchema).min(1),
  environment: VerificationEnvironmentSchema,
  testMutationPolicy: TestMutationPolicySchema,
  minimumEvidence: z.array(VerificationEvidenceRequirementSchema).min(1),
  authoredBy: z.union([InvocationReferenceSchema, ActorReferenceSchema]),
  approvedBy: z.union([InvocationReferenceSchema, ActorReferenceSchema]),
  approvedAt: TimestampSchema,
} as const;

function validateSpecification(
  specification: z.infer<z.ZodObject<typeof VerificationSpecificationFields>>,
  context: z.RefinementCtx,
): void {
  duplicate(
    specification.checks.map((check) => check.id),
    ['checks'],
    context,
  );
  duplicate(
    specification.minimumEvidence.map((requirement) => requirement.id),
    ['minimumEvidence'],
    context,
  );
  const checkedCriteria = new Set(specification.checks.flatMap((check) => check.criterionIds));
  for (const [index, requirement] of specification.minimumEvidence.entries()) {
    if (!checkedCriteria.has(requirement.criterionId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Evidence requirement has no verification check: ${requirement.criterionId}`,
        path: ['minimumEvidence', index, 'criterionId'],
      });
    }
  }
}

export const UnhashedVerificationSpecificationSchema = z
  .object(VerificationSpecificationFields)
  .strict()
  .superRefine(validateSpecification);
export type UnhashedVerificationSpecification = z.infer<
  typeof UnhashedVerificationSpecificationSchema
>;

export const VerificationSpecificationSchema = z
  .object({
    ...VerificationSpecificationFields,
    hashAlgorithm: z.literal('sha256'),
    hash: Sha256Schema,
  })
  .strict()
  .superRefine(validateSpecification);
export type VerificationSpecification = z.infer<typeof VerificationSpecificationSchema>;

export function sealVerificationSpecification(
  input: UnhashedVerificationSpecification,
): VerificationSpecification {
  const specification = UnhashedVerificationSpecificationSchema.parse(input);
  return VerificationSpecificationSchema.parse({
    ...specification,
    hashAlgorithm: 'sha256',
    hash: sha256Canonical(specification),
  });
}

export function verifyVerificationSpecificationHash(input: VerificationSpecification): boolean {
  const specification = VerificationSpecificationSchema.parse(input);
  const { hash, hashAlgorithm: _hashAlgorithm, ...unhashed } = specification;
  return hash === sha256Canonical(UnhashedVerificationSpecificationSchema.parse(unhashed));
}

export function freezeVerificationSpecification(
  specification: VerificationSpecification,
  contract: ChangeContract,
  plan: ExecutionPlan,
): Readonly<VerificationSpecification> {
  const parsed = VerificationSpecificationSchema.parse(specification);
  if (!verifyVerificationSpecificationHash(parsed)) {
    throw new Error('Verification Specification hash is invalid');
  }
  if (contract.status !== 'authorised' || parsed.contractHash !== contract.hash) {
    throw new Error('Verification Specification is not bound to the authorised contract');
  }
  if (
    plan.status !== 'approved' ||
    parsed.planId !== plan.id ||
    parsed.planHash !== plan.hash ||
    plan.contractHash !== contract.hash
  ) {
    throw new Error('Verification Specification is not bound to the approved plan');
  }
  if (plan.verificationSpecId !== parsed.id) {
    throw new Error('Approved plan references a different Verification Specification');
  }
  const criteria = new Set(contract.acceptanceCriteria.map((criterion) => criterion.id));
  for (const check of parsed.checks) {
    for (const criterionId of check.criterionIds) {
      if (!criteria.has(criterionId)) {
        throw new Error(`Verification check references unknown criterion: ${criterionId}`);
      }
    }
  }
  return deepFreeze(structuredClone(parsed));
}

export function assertFrozenVerificationInput(
  specification: VerificationSpecification,
  expectedHash: string,
): void {
  if (specification.hash !== expectedHash || !verifyVerificationSpecificationHash(specification)) {
    throw new Error('Executor verification input changed after approval');
  }
}

function duplicate(values: string[], path: string[], context: z.RefinementCtx): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate value: ${value}`,
        path: [...path, String(index)],
      });
    }
    seen.add(value);
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
