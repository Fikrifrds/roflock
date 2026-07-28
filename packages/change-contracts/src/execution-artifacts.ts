import { posix } from 'node:path';
import { sha256Canonical } from '@roleflock/contracts';
import { z } from 'zod';
import type { ChangeContract } from './index.js';

const IdentifierSchema = z.string().trim().min(1).max(160);
const NonEmptyTextSchema = z.string().trim().min(1);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const GitCommitSchema = z.string().regex(/^[a-f0-9]{7,64}$/);

export const RelativePlanPathSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.startsWith('/'), 'Plan paths must be repository-relative')
  .refine((value) => !value.split('/').includes('..'), 'Plan paths cannot escape the repository')
  .transform((value) => posix.normalize(value.replaceAll('\\', '/')))
  .refine((value) => value !== '.' && !value.startsWith('../'), 'Plan path is not specific');

export const ArtifactReferenceSchema = z
  .object({
    id: IdentifierSchema,
    digest: Sha256Schema,
  })
  .strict();
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;

export const InvocationReferenceSchema = z
  .object({
    invocationId: IdentifierSchema,
    role: IdentifierSchema,
    providerId: IdentifierSchema,
    modelId: IdentifierSchema,
  })
  .strict();
export type InvocationReference = z.infer<typeof InvocationReferenceSchema>;

export const ActorReferenceSchema = z
  .object({
    actorId: IdentifierSchema,
    actorType: z.enum(['human', 'policy', 'service']),
  })
  .strict();
export type ActorReference = z.infer<typeof ActorReferenceSchema>;

export const PlanAssumptionSchema = z
  .object({
    id: IdentifierSchema,
    statement: NonEmptyTextSchema,
    riskIfFalse: NonEmptyTextSchema,
    status: z.enum(['unverified', 'verified', 'rejected']),
    evidence: z.array(ArtifactReferenceSchema),
  })
  .strict();
export type PlanAssumption = z.infer<typeof PlanAssumptionSchema>;

export const PlannedOperationSchema = z.enum([
  'create_file',
  'modify_file',
  'delete_file',
  'rename_file',
  'add_dependency',
  'remove_dependency',
  'modify_schema',
  'run_command',
]);
export type PlannedOperation = z.infer<typeof PlannedOperationSchema>;

export const PlannedDependencyChangeSchema = z
  .object({
    packageName: IdentifierSchema,
    ecosystem: z.enum(['npm', 'cargo', 'composer', 'pip', 'go', 'other']),
    action: z.enum(['add', 'remove', 'upgrade', 'downgrade']),
    fromVersion: NonEmptyTextSchema.optional(),
    toVersion: NonEmptyTextSchema.optional(),
    reason: NonEmptyTextSchema,
  })
  .strict();
export type PlannedDependencyChange = z.infer<typeof PlannedDependencyChangeSchema>;

export const PlannedMigrationActionSchema = z
  .object({
    id: IdentifierSchema,
    kind: z.enum(['database', 'data', 'configuration', 'api', 'other']),
    description: NonEmptyTextSchema,
    rollback: NonEmptyTextSchema,
    destructive: z.boolean(),
  })
  .strict();
export type PlannedMigrationAction = z.infer<typeof PlannedMigrationActionSchema>;

export const RepairEnvelopeSchema = z
  .object({
    allowedFailureClasses: z.array(
      z.enum([
        'formatting',
        'lint_autofix',
        'type_annotation',
        'test_snapshot',
        'generated_artifact',
      ]),
    ),
    maxAttempts: z.number().int().min(0).max(20),
    mayAddFiles: z.boolean(),
    mayChangeDependencies: z.boolean(),
    mayChangePublicApi: z.boolean(),
    mayChangeSchema: z.boolean(),
    pathScope: z.array(RelativePlanPathSchema),
  })
  .strict();
export type RepairEnvelope = z.infer<typeof RepairEnvelopeSchema>;

export const ChangeBudgetSchema = z
  .object({
    maxChangedFiles: z.number().int().positive(),
    maxAddedLines: z.number().int().nonnegative(),
    maxDeletedLines: z.number().int().nonnegative(),
    maxNewDependencies: z.number().int().nonnegative(),
  })
  .strict();
export type ChangeBudget = z.infer<typeof ChangeBudgetSchema>;

export const PlanDecisionSchema = z
  .object({
    id: IdentifierSchema,
    question: NonEmptyTextSchema,
    decision: NonEmptyTextSchema,
    rationale: NonEmptyTextSchema,
    authoritySourceIds: z.array(IdentifierSchema),
  })
  .strict();
export type PlanDecision = z.infer<typeof PlanDecisionSchema>;

export const PlanStepSchema = z
  .object({
    id: IdentifierSchema,
    objective: NonEmptyTextSchema,
    criterionIds: z.array(IdentifierSchema).min(1),
    allowedOperations: z.array(PlannedOperationSchema).min(1),
    expectedFiles: z.array(RelativePlanPathSchema),
    completionEvidenceIds: z.array(IdentifierSchema).min(1),
  })
  .strict();
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const ExecutionPlanStatusSchema = z.enum([
  'proposed',
  'approved',
  'superseded',
  'cancelled',
]);
export type ExecutionPlanStatus = z.infer<typeof ExecutionPlanStatusSchema>;

const ExecutionPlanFields = {
  id: IdentifierSchema,
  taskId: IdentifierSchema,
  contractId: IdentifierSchema,
  contractHash: Sha256Schema,
  version: z.number().int().positive(),
  status: ExecutionPlanStatusSchema,
  summary: NonEmptyTextSchema,
  assumptions: z.array(PlanAssumptionSchema),
  steps: z.array(PlanStepSchema).min(1),
  allowedPaths: z.array(RelativePlanPathSchema).min(1),
  expectedChangedPaths: z.array(RelativePlanPathSchema).min(1),
  forbiddenPaths: z.array(RelativePlanPathSchema),
  dependencyChanges: z.array(PlannedDependencyChangeSchema),
  migrationActions: z.array(PlannedMigrationActionSchema),
  verificationSpecId: IdentifierSchema,
  repairEnvelope: RepairEnvelopeSchema,
  changeBudget: ChangeBudgetSchema,
  decisionLog: z.array(PlanDecisionSchema),
  parentPlanId: IdentifierSchema.optional(),
  revisionReason: NonEmptyTextSchema.optional(),
  proposedBy: InvocationReferenceSchema,
  reviewedBy: z.union([InvocationReferenceSchema, ActorReferenceSchema]).optional(),
  approvedAt: TimestampSchema.optional(),
} as const;

function duplicateIssues(
  values: readonly string[],
  path: (string | number)[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate value: ${value}`,
        path: [...path, index],
      });
    }
    seen.add(value);
  });
}

function pathContains(scope: string, candidate: string): boolean {
  return candidate === scope || candidate.startsWith(`${scope}/`);
}

function validateExecutionPlan(
  plan: z.infer<z.ZodObject<typeof ExecutionPlanFields>>,
  context: z.RefinementCtx,
): void {
  duplicateIssues(
    plan.steps.map((step) => step.id),
    ['steps'],
    context,
  );
  duplicateIssues(
    plan.assumptions.map((assumption) => assumption.id),
    ['assumptions'],
    context,
  );
  duplicateIssues(plan.allowedPaths, ['allowedPaths'], context);
  duplicateIssues(plan.expectedChangedPaths, ['expectedChangedPaths'], context);
  duplicateIssues(plan.forbiddenPaths, ['forbiddenPaths'], context);

  if (
    plan.version === 1 &&
    (plan.parentPlanId !== undefined || plan.revisionReason !== undefined)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'The first plan version cannot have revision lineage',
      path: ['parentPlanId'],
    });
  }
  if (plan.version > 1 && (plan.parentPlanId === undefined || plan.revisionReason === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A revised plan requires parentPlanId and revisionReason',
      path: ['parentPlanId'],
    });
  }

  const approvalRequired = plan.status === 'approved' || plan.status === 'superseded';
  if (approvalRequired && (plan.reviewedBy === undefined || plan.approvedAt === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${plan.status} plan requires reviewedBy and approvedAt`,
      path: ['reviewedBy'],
    });
  }
  if (!approvalRequired && (plan.reviewedBy !== undefined || plan.approvedAt !== undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Only an approved or superseded plan may contain approval metadata',
      path: ['reviewedBy'],
    });
  }

  plan.expectedChangedPaths.forEach((path, index) => {
    if (!plan.allowedPaths.some((scope) => pathContains(scope, path))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Expected path is outside allowed paths: ${path}`,
        path: ['expectedChangedPaths', index],
      });
    }
  });
  plan.steps.forEach((step, stepIndex) => {
    duplicateIssues(step.criterionIds, ['steps', stepIndex, 'criterionIds'], context);
    duplicateIssues(
      step.completionEvidenceIds,
      ['steps', stepIndex, 'completionEvidenceIds'],
      context,
    );
    step.expectedFiles.forEach((path, pathIndex) => {
      if (!plan.allowedPaths.some((scope) => pathContains(scope, path))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Step file is outside allowed paths: ${path}`,
          path: ['steps', stepIndex, 'expectedFiles', pathIndex],
        });
      }
    });
  });
  plan.forbiddenPaths.forEach((forbidden, index) => {
    if (plan.allowedPaths.some((allowed) => pathContains(allowed, forbidden))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Forbidden path is nested in an allowed path: ${forbidden}`,
        path: ['forbiddenPaths', index],
      });
    }
  });
}

export const UnhashedExecutionPlanSchema = z
  .object(ExecutionPlanFields)
  .strict()
  .superRefine(validateExecutionPlan);
export type UnhashedExecutionPlan = z.infer<typeof UnhashedExecutionPlanSchema>;

export const ExecutionPlanSchema = z
  .object({
    ...ExecutionPlanFields,
    hashAlgorithm: z.literal('sha256'),
    hash: Sha256Schema,
  })
  .strict()
  .superRefine(validateExecutionPlan);
export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

export const PlanCritiqueFindingSchema = z
  .object({
    id: IdentifierSchema,
    criterionIds: z.array(IdentifierSchema),
    severity: z.enum(['info', 'warning', 'blocking']),
    category: z.enum([
      'contract_mismatch',
      'missing_step',
      'unsafe_operation',
      'verification_gap',
      'path_scope',
      'dependency_risk',
      'migration_risk',
      'unclear_assumption',
    ]),
    statement: NonEmptyTextSchema,
    evidence: z.array(ArtifactReferenceSchema),
  })
  .strict();
export type PlanCritiqueFinding = z.infer<typeof PlanCritiqueFindingSchema>;

const PlanCritiqueFields = {
  id: IdentifierSchema,
  taskId: IdentifierSchema,
  planId: IdentifierSchema,
  planHash: Sha256Schema,
  verdict: z.enum(['approve', 'revise']),
  findings: z.array(PlanCritiqueFindingSchema),
  reviewedBy: InvocationReferenceSchema,
  createdAt: TimestampSchema,
} as const;

function validatePlanCritique(
  critique: z.infer<z.ZodObject<typeof PlanCritiqueFields>>,
  context: z.RefinementCtx,
): void {
  duplicateIssues(
    critique.findings.map((finding) => finding.id),
    ['findings'],
    context,
  );
  const blocking = critique.findings.some((finding) => finding.severity === 'blocking');
  if (critique.verdict === 'approve' && blocking) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A critique with blocking findings cannot approve the plan',
      path: ['verdict'],
    });
  }
  if (critique.verdict === 'revise' && critique.findings.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A revise verdict requires at least one finding',
      path: ['findings'],
    });
  }
}

export const UnhashedPlanCritiqueSchema = z
  .object(PlanCritiqueFields)
  .strict()
  .superRefine(validatePlanCritique);
export type UnhashedPlanCritique = z.infer<typeof UnhashedPlanCritiqueSchema>;

export const PlanCritiqueSchema = z
  .object({ ...PlanCritiqueFields, hashAlgorithm: z.literal('sha256'), hash: Sha256Schema })
  .strict()
  .superRefine(validatePlanCritique);
export type PlanCritique = z.infer<typeof PlanCritiqueSchema>;

export const PlanDeviationTypeSchema = z.enum([
  'unexpected_file',
  'unplanned_dependency',
  'architecture_decision',
  'requirement_ambiguity',
  'verification_gap',
  'scope_expansion',
  'policy_conflict',
  'environment_mismatch',
]);
export type PlanDeviationType = z.infer<typeof PlanDeviationTypeSchema>;

const PlanDeviationFields = {
  id: IdentifierSchema,
  planId: IdentifierSchema,
  planHash: Sha256Schema,
  detectedBy: z.enum(['executor', 'runtime', 'verifier', 'human']),
  type: PlanDeviationTypeSchema,
  evidence: z.array(ArtifactReferenceSchema).min(1),
  proposedOptions: z.array(NonEmptyTextSchema),
  status: z.enum(['open', 'resolved_by_plan_revision', 'rejected', 'waived']),
  resolutionPlanId: IdentifierSchema.optional(),
  resolvedBy: z.union([InvocationReferenceSchema, ActorReferenceSchema]).optional(),
  resolvedAt: TimestampSchema.optional(),
} as const;

function validatePlanDeviation(
  deviation: z.infer<z.ZodObject<typeof PlanDeviationFields>>,
  context: z.RefinementCtx,
): void {
  const resolved = deviation.status !== 'open';
  if (resolved !== (deviation.resolvedBy !== undefined && deviation.resolvedAt !== undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Deviation resolution metadata must exactly match a resolved status',
      path: ['status'],
    });
  }
  if (
    deviation.status === 'resolved_by_plan_revision' &&
    deviation.resolutionPlanId === undefined
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A plan-revision resolution requires resolutionPlanId',
      path: ['resolutionPlanId'],
    });
  }
}

export const UnhashedPlanDeviationSchema = z
  .object(PlanDeviationFields)
  .strict()
  .superRefine(validatePlanDeviation);
export type UnhashedPlanDeviation = z.infer<typeof UnhashedPlanDeviationSchema>;

export const PlanDeviationSchema = z
  .object({ ...PlanDeviationFields, hashAlgorithm: z.literal('sha256'), hash: Sha256Schema })
  .strict()
  .superRefine(validatePlanDeviation);
export type PlanDeviation = z.infer<typeof PlanDeviationSchema>;

const ExecutionReportFields = {
  id: IdentifierSchema,
  taskId: IdentifierSchema,
  planId: IdentifierSchema,
  planHash: Sha256Schema,
  baseCommit: GitCommitSchema,
  resultCommit: GitCommitSchema.optional(),
  completedStepIds: z.array(IdentifierSchema),
  changedPaths: z.array(RelativePlanPathSchema),
  commandsRun: z.array(ArtifactReferenceSchema),
  claimedEvidence: z.array(ArtifactReferenceSchema),
  deviations: z.array(PlanDeviationSchema),
  unresolvedIssues: z.array(NonEmptyTextSchema),
  createdBy: InvocationReferenceSchema,
  createdAt: TimestampSchema,
} as const;

function validateExecutionReport(
  report: z.infer<z.ZodObject<typeof ExecutionReportFields>>,
  context: z.RefinementCtx,
): void {
  duplicateIssues(report.completedStepIds, ['completedStepIds'], context);
  duplicateIssues(report.changedPaths, ['changedPaths'], context);
  duplicateIssues(
    report.deviations.map((deviation) => deviation.id),
    ['deviations'],
    context,
  );
  if (report.changedPaths.length > 0 && report.resultCommit === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A report with changed paths requires a resultCommit',
      path: ['resultCommit'],
    });
  }
}

export const UnhashedExecutionReportSchema = z
  .object(ExecutionReportFields)
  .strict()
  .superRefine(validateExecutionReport);
export type UnhashedExecutionReport = z.infer<typeof UnhashedExecutionReportSchema>;

export const ExecutionReportSchema = z
  .object({ ...ExecutionReportFields, hashAlgorithm: z.literal('sha256'), hash: Sha256Schema })
  .strict()
  .superRefine(validateExecutionReport);
export type ExecutionReport = z.infer<typeof ExecutionReportSchema>;

export function createExecutionPlanHash(input: UnhashedExecutionPlan): string {
  return sha256Canonical(UnhashedExecutionPlanSchema.parse(input));
}

export function sealExecutionPlan(input: UnhashedExecutionPlan): ExecutionPlan {
  const plan = UnhashedExecutionPlanSchema.parse(input);
  return ExecutionPlanSchema.parse({
    ...plan,
    hashAlgorithm: 'sha256',
    hash: createExecutionPlanHash(plan),
  });
}

export function verifyExecutionPlanHash(input: ExecutionPlan): boolean {
  const plan = ExecutionPlanSchema.parse(input);
  const { hash, hashAlgorithm: _hashAlgorithm, ...unhashed } = plan;
  return hash === createExecutionPlanHash(unhashed);
}

export function createPlanCritiqueHash(input: UnhashedPlanCritique): string {
  return sha256Canonical(UnhashedPlanCritiqueSchema.parse(input));
}

export function sealPlanCritique(input: UnhashedPlanCritique): PlanCritique {
  const critique = UnhashedPlanCritiqueSchema.parse(input);
  return PlanCritiqueSchema.parse({
    ...critique,
    hashAlgorithm: 'sha256',
    hash: createPlanCritiqueHash(critique),
  });
}

export function verifyPlanCritiqueHash(input: PlanCritique): boolean {
  const critique = PlanCritiqueSchema.parse(input);
  const { hash, hashAlgorithm: _hashAlgorithm, ...unhashed } = critique;
  return hash === createPlanCritiqueHash(unhashed);
}

export function createPlanDeviationHash(input: UnhashedPlanDeviation): string {
  return sha256Canonical(UnhashedPlanDeviationSchema.parse(input));
}

export function sealPlanDeviation(input: UnhashedPlanDeviation): PlanDeviation {
  const deviation = UnhashedPlanDeviationSchema.parse(input);
  return PlanDeviationSchema.parse({
    ...deviation,
    hashAlgorithm: 'sha256',
    hash: createPlanDeviationHash(deviation),
  });
}

export function verifyPlanDeviationHash(input: PlanDeviation): boolean {
  const deviation = PlanDeviationSchema.parse(input);
  const { hash, hashAlgorithm: _hashAlgorithm, ...unhashed } = deviation;
  return hash === createPlanDeviationHash(unhashed);
}

export function createExecutionReportHash(input: UnhashedExecutionReport): string {
  return sha256Canonical(UnhashedExecutionReportSchema.parse(input));
}

export function sealExecutionReport(input: UnhashedExecutionReport): ExecutionReport {
  const report = UnhashedExecutionReportSchema.parse(input);
  return ExecutionReportSchema.parse({
    ...report,
    hashAlgorithm: 'sha256',
    hash: createExecutionReportHash(report),
  });
}

export function verifyExecutionReportHash(input: ExecutionReport): boolean {
  const report = ExecutionReportSchema.parse(input);
  const { hash, hashAlgorithm: _hashAlgorithm, ...unhashed } = report;
  return hash === createExecutionReportHash(unhashed);
}

export function validateExecutionPlanAgainstContract(
  plan: ExecutionPlan,
  contract: ChangeContract,
): void {
  if (plan.taskId !== contract.taskId || plan.contractId !== contract.id) {
    throw new Error('Execution Plan does not belong to the supplied Change Contract');
  }
  if (plan.contractHash !== contract.hash) {
    throw new Error('Execution Plan contract hash does not match the supplied Change Contract');
  }
  if (contract.status !== 'authorised') {
    throw new Error('Execution Plan requires an authorised Change Contract');
  }

  const criterionIds = new Set(contract.acceptanceCriteria.map((criterion) => criterion.id));
  const evidenceIds = new Set(contract.requiredEvidence.map((evidence) => evidence.id));
  const coveredCriteria = new Set<string>();
  for (const step of plan.steps) {
    for (const criterionId of step.criterionIds) {
      if (!criterionIds.has(criterionId)) {
        throw new Error(`Plan step ${step.id} references unknown criterion ${criterionId}`);
      }
      coveredCriteria.add(criterionId);
    }
    for (const evidenceId of step.completionEvidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`Plan step ${step.id} references unknown evidence ${evidenceId}`);
      }
    }
  }
  for (const criterionId of criterionIds) {
    if (!coveredCriteria.has(criterionId)) {
      throw new Error(`Execution Plan does not cover criterion ${criterionId}`);
    }
  }
}

export function validateExecutionReportAgainstPlan(
  report: ExecutionReport,
  plan: ExecutionPlan,
): void {
  if (report.taskId !== plan.taskId || report.planId !== plan.id || report.planHash !== plan.hash) {
    throw new Error('Execution Report is not pinned to the supplied Execution Plan');
  }
  const stepIds = new Set(plan.steps.map((step) => step.id));
  for (const stepId of report.completedStepIds) {
    if (!stepIds.has(stepId)) throw new Error(`Execution Report contains unknown step ${stepId}`);
  }
  for (const path of report.changedPaths) {
    if (!plan.allowedPaths.some((scope) => pathContains(scope, path))) {
      throw new Error(`Execution Report changed path outside the approved plan: ${path}`);
    }
  }
}
