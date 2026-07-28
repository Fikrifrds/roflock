import {
  ExecutionPlanSchema,
  verifyExecutionPlanHash,
  type ExecutionPlan,
  type PlannedOperation,
} from './execution-artifacts.js';

function pathContains(scope: string, candidate: string): boolean {
  return candidate === scope || candidate.startsWith(`${scope}/`);
}

export function parseApprovedExecutionPlan(input: unknown): ExecutionPlan {
  const plan = ExecutionPlanSchema.parse(input);
  if (plan.status !== 'approved') {
    throw new Error(`Executor requires an approved plan, received ${plan.status}`);
  }
  if (!verifyExecutionPlanHash(plan)) {
    throw new Error(`Executor plan hash mismatch for ${plan.id}`);
  }
  return plan;
}

export function executorInstructionBlock(planInput: unknown): string {
  const plan = parseApprovedExecutionPlan(planInput);
  return [
    `PINNED EXECUTION PLAN ${plan.id} v${plan.version}`,
    `PLAN HASH: ${plan.hash}`,
    'This artifact is authoritative and immutable for this invocation.',
    'Perform only declared steps, operations, and paths. Stop and emit a deviation on ambiguity.',
    'Do not reinterpret stakeholder feedback, revise the plan, or make an undeclared decision.',
    JSON.stringify(plan),
  ].join('\n');
}

export function executorPermissionEnvelope(
  planInput: unknown,
  worktree: string,
): { worktree: string; allowedPaths: string[]; allowCommands: boolean } {
  const plan = parseApprovedExecutionPlan(planInput);
  return {
    worktree,
    allowedPaths: [...plan.allowedPaths],
    allowCommands: plan.steps.some((step) => step.allowedOperations.includes('run_command')),
  };
}

export function assertExecutorOperationAllowed(
  planInput: unknown,
  operation: PlannedOperation,
): void {
  const plan = parseApprovedExecutionPlan(planInput);
  if (!plan.steps.some((step) => step.allowedOperations.includes(operation))) {
    throw new Error(`Plan ${plan.id} does not allow operation ${operation}`);
  }
}

export function assertExecutorChangedPaths(
  planInput: unknown,
  changedPaths: readonly string[],
): void {
  const plan = parseApprovedExecutionPlan(planInput);
  for (const path of changedPaths) {
    if (!plan.allowedPaths.some((scope) => pathContains(scope, path))) {
      throw new Error(`Execution changed path outside approved plan ${plan.hash}: ${path}`);
    }
    if (plan.forbiddenPaths.some((scope) => pathContains(scope, path))) {
      throw new Error(`Execution changed forbidden path in plan ${plan.hash}: ${path}`);
    }
  }
}
