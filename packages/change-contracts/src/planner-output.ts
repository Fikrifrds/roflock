import { z } from 'zod';
import type { ChangeContract } from './index.js';
import {
  ChangeBudgetSchema,
  PlanAssumptionSchema,
  PlanDecisionSchema,
  PlanStepSchema,
  PlannedDependencyChangeSchema,
  PlannedMigrationActionSchema,
  RepairEnvelopeSchema,
  sealExecutionPlan,
  validateExecutionPlanAgainstContract,
  type ExecutionPlan,
  type InvocationReference,
} from './execution-artifacts.js';

const NonEmptyTextSchema = z.string().trim().min(1);
const PlanLineageSchema = z
  .object({
    parentPlanId: z.string().trim().min(1),
    revisionReason: NonEmptyTextSchema,
  })
  .strict();

export const PlannerPlanProposalSchema = z
  .object({
    summary: NonEmptyTextSchema,
    assumptions: z.array(PlanAssumptionSchema),
    steps: z.array(PlanStepSchema).min(1),
    allowedPaths: z.array(z.string().trim().min(1)).min(1),
    expectedChangedPaths: z.array(z.string().trim().min(1)).min(1),
    forbiddenPaths: z.array(z.string().trim().min(1)),
    dependencyChanges: z.array(PlannedDependencyChangeSchema),
    migrationActions: z.array(PlannedMigrationActionSchema),
    verificationSpecId: z.string().trim().min(1),
    repairEnvelope: RepairEnvelopeSchema,
    changeBudget: ChangeBudgetSchema,
    decisionLog: z.array(PlanDecisionSchema),
  })
  .strict();
export type PlannerPlanProposal = z.infer<typeof PlannerPlanProposalSchema>;

export type CompilePlannerProposalInput = {
  output: string;
  planId: string;
  version: number;
  contract: ChangeContract;
  proposedBy: InvocationReference;
  lineage?: z.infer<typeof PlanLineageSchema>;
};

function extractJsonObject(output: string): unknown {
  const trimmed = output.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1] ?? trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end < start) {
    throw new Error('Planner output does not contain a JSON object');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (error) {
    throw new Error('Planner output contains invalid JSON', { cause: error });
  }
}

export function parsePlannerPlanProposal(output: string): PlannerPlanProposal {
  return PlannerPlanProposalSchema.parse(extractJsonObject(output));
}

export function compilePlannerPlanProposal(input: CompilePlannerProposalInput): ExecutionPlan {
  const proposal = parsePlannerPlanProposal(input.output);
  if (input.contract.status !== 'authorised') {
    throw new Error('Planner output cannot compile against an unauthorised Change Contract');
  }
  if (input.version === 1 && input.lineage !== undefined) {
    throw new Error('The first Execution Plan cannot have revision lineage');
  }
  const lineage = input.version === 1 ? {} : PlanLineageSchema.parse(input.lineage);
  const plan = sealExecutionPlan({
    id: input.planId,
    taskId: input.contract.taskId,
    contractId: input.contract.id,
    contractHash: input.contract.hash,
    version: input.version,
    status: 'proposed',
    ...proposal,
    ...lineage,
    proposedBy: input.proposedBy,
  });
  validateExecutionPlanAgainstContract(plan, input.contract);
  return plan;
}

export function plannerStructuredOutputPrompt(contract: ChangeContract): string {
  const criterionIds = contract.acceptanceCriteria.map((criterion) => criterion.id).join(', ');
  const evidenceIds = contract.requiredEvidence.map((evidence) => evidence.id).join(', ');
  return [
    'Return exactly one JSON object. Do not use markdown or prose outside the object.',
    'You propose an Execution Plan; you cannot approve it or alter the Change Contract.',
    `Every plan step must reference criterion IDs from: ${criterionIds}.`,
    `Every completionEvidenceIds entry must reference IDs from: ${evidenceIds}.`,
    'Required top-level keys:',
    'summary, assumptions, steps, allowedPaths, expectedChangedPaths, forbiddenPaths,',
    'dependencyChanges, migrationActions, verificationSpecId, repairEnvelope, changeBudget, decisionLog.',
    'Use repository-relative paths. Declare every dependency, migration, and decision explicitly.',
  ].join('\n');
}
