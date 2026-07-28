import { sha256Canonical } from '@roleflock/contracts';
import { z } from 'zod';

const NonEmptyTextSchema = z.string().trim().min(1);
const IdentifierSchema = z.string().trim().min(1).max(160);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

export const ChangeContractStatusSchema = z.enum([
  'draft',
  'needs_clarification',
  'awaiting_authorisation',
  'authorised',
  'superseded',
  'withdrawn',
]);
export type ChangeContractStatus = z.infer<typeof ChangeContractStatusSchema>;

export const ContractRiskSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type ContractRisk = z.infer<typeof ContractRiskSchema>;

export const VerificationTypeSchema = z.enum([
  'automated_test',
  'static_analysis',
  'build',
  'security_scan',
  'performance_measurement',
  'visual_review',
  'manual_review',
  'external_observation',
]);
export type VerificationType = z.infer<typeof VerificationTypeSchema>;

export const EvidenceTypeSchema = z.enum([
  'test_result',
  'build_result',
  'static_analysis_result',
  'security_scan_result',
  'performance_result',
  'visual_artifact',
  'diff_review',
  'manual_attestation',
  'external_attestation',
]);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export const AuthoritySourceKindSchema = z.enum([
  'user_input',
  'issue',
  'specification',
  'organisation_policy',
  'repository_document',
  'external_reference',
]);
export type AuthoritySourceKind = z.infer<typeof AuthoritySourceKindSchema>;

export const AcceptanceCriterionSchema = z
  .object({
    id: IdentifierSchema,
    statement: NonEmptyTextSchema,
    verificationType: VerificationTypeSchema,
    requiredEvidenceIds: z.array(IdentifierSchema).min(1),
  })
  .strict();
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const EvidenceRequirementSchema = z
  .object({
    id: IdentifierSchema,
    type: EvidenceTypeSchema,
    description: NonEmptyTextSchema,
    mandatory: z.boolean(),
  })
  .strict();
export type EvidenceRequirement = z.infer<typeof EvidenceRequirementSchema>;

export const ProhibitedOutcomeSchema = z
  .object({
    id: IdentifierSchema,
    statement: NonEmptyTextSchema,
    severity: ContractRiskSchema,
  })
  .strict();
export type ProhibitedOutcome = z.infer<typeof ProhibitedOutcomeSchema>;

export const AuthoritySourceSchema = z
  .object({
    id: IdentifierSchema,
    kind: AuthoritySourceKindSchema,
    locator: NonEmptyTextSchema,
    digest: Sha256Schema,
    title: NonEmptyTextSchema.optional(),
  })
  .strict();
export type AuthoritySource = z.infer<typeof AuthoritySourceSchema>;

export const ContractQuestionStatusSchema = z.enum(['open', 'resolved', 'waived']);
export type ContractQuestionStatus = z.infer<typeof ContractQuestionStatusSchema>;

export const ContractQuestionSchema = z
  .object({
    id: IdentifierSchema,
    question: NonEmptyTextSchema,
    blocking: z.boolean(),
    status: ContractQuestionStatusSchema,
    resolution: NonEmptyTextSchema.optional(),
    resolvedBy: IdentifierSchema.optional(),
    resolvedAt: TimestampSchema.optional(),
  })
  .strict()
  .superRefine((question, context) => {
    if (question.status === 'open') {
      if (
        question.resolution !== undefined ||
        question.resolvedBy !== undefined ||
        question.resolvedAt !== undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'An open question cannot contain resolution metadata',
        });
      }
      return;
    }

    if (
      question.resolution === undefined ||
      question.resolvedBy === undefined ||
      question.resolvedAt === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A resolved or waived question requires resolution, resolvedBy, and resolvedAt',
      });
    }
  });
export type ContractQuestion = z.infer<typeof ContractQuestionSchema>;

const ChangeContractFields = {
  id: IdentifierSchema,
  taskId: IdentifierSchema,
  projectId: IdentifierSchema,
  repositoryId: IdentifierSchema,
  version: z.number().int().positive(),
  parentVersionId: IdentifierSchema.optional(),
  changeReason: NonEmptyTextSchema.optional(),
  status: ChangeContractStatusSchema,
  objective: NonEmptyTextSchema,
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
  prohibitedOutcomes: z.array(ProhibitedOutcomeSchema),
  outOfScope: z.array(NonEmptyTextSchema),
  risk: ContractRiskSchema,
  requiredEvidence: z.array(EvidenceRequirementSchema).min(1),
  authoritySources: z.array(AuthoritySourceSchema).min(1),
  unresolvedQuestions: z.array(ContractQuestionSchema),
  draftedBy: IdentifierSchema,
  authorisedBy: IdentifierSchema.optional(),
  authorisedAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
} as const;

const terminalOrAuthorisedStatuses = new Set<ChangeContractStatus>([
  'authorised',
  'superseded',
  'withdrawn',
]);

function addDuplicateIssues(
  values: readonly { id: string }[],
  path: (string | number)[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate id: ${value.id}`,
        path: [...path, index, 'id'],
      });
    }
    seen.add(value.id);
  });
}

function validateContractSemantics(
  contract: z.infer<z.ZodObject<typeof ChangeContractFields>>,
  context: z.RefinementCtx,
): void {
  addDuplicateIssues(contract.acceptanceCriteria, ['acceptanceCriteria'], context);
  addDuplicateIssues(contract.prohibitedOutcomes, ['prohibitedOutcomes'], context);
  addDuplicateIssues(contract.requiredEvidence, ['requiredEvidence'], context);
  addDuplicateIssues(contract.authoritySources, ['authoritySources'], context);
  addDuplicateIssues(contract.unresolvedQuestions, ['unresolvedQuestions'], context);

  const evidenceIds = new Set(contract.requiredEvidence.map((requirement) => requirement.id));
  contract.acceptanceCriteria.forEach((criterion, criterionIndex) => {
    const criterionEvidenceIds = new Set<string>();
    criterion.requiredEvidenceIds.forEach((evidenceId, evidenceIndex) => {
      if (criterionEvidenceIds.has(evidenceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate required evidence reference: ${evidenceId}`,
          path: ['acceptanceCriteria', criterionIndex, 'requiredEvidenceIds', evidenceIndex],
        });
      }
      criterionEvidenceIds.add(evidenceId);

      if (!evidenceIds.has(evidenceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown required evidence reference: ${evidenceId}`,
          path: ['acceptanceCriteria', criterionIndex, 'requiredEvidenceIds', evidenceIndex],
        });
      }
    });
  });

  if (contract.version === 1 && contract.parentVersionId !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'The first contract version cannot have a parentVersionId',
      path: ['parentVersionId'],
    });
  }
  if (
    contract.version > 1 &&
    (contract.parentVersionId === undefined || contract.changeReason === undefined)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A revised contract requires parentVersionId and changeReason',
      path: ['parentVersionId'],
    });
  }

  if (terminalOrAuthorisedStatuses.has(contract.status)) {
    if (contract.authorisedBy === undefined || contract.authorisedAt === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${contract.status} contract requires authorisedBy and authorisedAt`,
        path: ['authorisedBy'],
      });
    }

    const blockingQuestion = contract.unresolvedQuestions.find(
      (question) => question.blocking && question.status === 'open',
    );
    if (blockingQuestion !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Blocking question remains open: ${blockingQuestion.id}`,
        path: ['unresolvedQuestions'],
      });
    }
  } else if (contract.authorisedBy !== undefined || contract.authorisedAt !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Only an authorised or terminal contract may contain authorisation metadata',
      path: ['authorisedBy'],
    });
  }
}

export const UnhashedChangeContractSchema = z
  .object(ChangeContractFields)
  .strict()
  .superRefine(validateContractSemantics);
export type UnhashedChangeContract = z.infer<typeof UnhashedChangeContractSchema>;

export const ChangeContractSchema = z
  .object({
    ...ChangeContractFields,
    hashAlgorithm: z.literal('sha256'),
    hash: Sha256Schema,
  })
  .strict()
  .superRefine(validateContractSemantics);
export type ChangeContract = z.infer<typeof ChangeContractSchema>;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortedById<T extends { id: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => compareText(left.id, right.id));
}

/**
 * Returns the semantic representation used for artifact identity.
 *
 * Acceptance criteria deliberately retain their order because their order is
 * presentation and review order. Collections whose order has no meaning are
 * sorted, including evidence references within a criterion.
 */
export function canonicalChangeContractContent(
  input: UnhashedChangeContract,
): UnhashedChangeContract {
  const contract = UnhashedChangeContractSchema.parse(input);
  return {
    ...contract,
    acceptanceCriteria: contract.acceptanceCriteria.map((criterion) => ({
      ...criterion,
      requiredEvidenceIds: [...criterion.requiredEvidenceIds].sort(compareText),
    })),
    prohibitedOutcomes: sortedById(contract.prohibitedOutcomes),
    outOfScope: [...contract.outOfScope].sort(compareText),
    requiredEvidence: sortedById(contract.requiredEvidence),
    authoritySources: sortedById(contract.authoritySources),
    unresolvedQuestions: sortedById(contract.unresolvedQuestions),
  };
}

export function createChangeContractHash(input: UnhashedChangeContract): string {
  return sha256Canonical(canonicalChangeContractContent(input));
}

export function sealChangeContract(input: UnhashedChangeContract): ChangeContract {
  const contract = UnhashedChangeContractSchema.parse(input);
  return ChangeContractSchema.parse({
    ...contract,
    hashAlgorithm: 'sha256',
    hash: createChangeContractHash(contract),
  });
}

export function verifyChangeContractHash(input: ChangeContract): boolean {
  const contract = ChangeContractSchema.parse(input);
  const { hash: suppliedHash, hashAlgorithm: _hashAlgorithm, ...unhashed } = contract;
  return suppliedHash === createChangeContractHash(unhashed);
}

export function parseVerifiedChangeContract(input: unknown): ChangeContract {
  const contract = ChangeContractSchema.parse(input);
  if (!verifyChangeContractHash(contract)) {
    throw new Error(`Change Contract hash mismatch for ${contract.id} version ${contract.version}`);
  }
  return contract;
}

export * from './service.js';
export * from './execution-artifacts.js';
export * from './planner-output.js';
export * from './executor-assignment.js';
export * from './repair-envelope.js';
