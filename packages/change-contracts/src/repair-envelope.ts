import { parseApprovedExecutionPlan } from './executor-assignment.js';
import type { ExecutionPlan, PlannedOperation, RepairEnvelope } from './execution-artifacts.js';

export type MechanicalFailureClass = RepairEnvelope['allowedFailureClasses'][number];

export type RepairEvaluationInput = {
  failureClass: MechanicalFailureClass;
  changedPaths: readonly string[];
  requiredOperations: readonly PlannedOperation[];
  attempt: number;
  deterministic: boolean;
  addsFiles: boolean;
  changesDependencies: boolean;
  changesPublicApi: boolean;
  changesSchema: boolean;
  requiresArchitectureDecision: boolean;
  expandsScope: boolean;
  changesRequirement: boolean;
  planStillSufficient: boolean;
  contractStillSufficient: boolean;
  retryBudgetRemaining: boolean;
  costBudgetRemaining: boolean;
  timeBudgetRemaining: boolean;
};

export type RepairEvaluation = {
  allowed: boolean;
  decision: 'repair_allowed' | 'planner_required';
  reasons: string[];
  planId: string;
  planHash: string;
};

function pathContains(scope: string, candidate: string): boolean {
  return candidate === scope || candidate.startsWith(`${scope}/`);
}

export function evaluateRepairEnvelope(
  planInput: ExecutionPlan,
  input: RepairEvaluationInput,
): RepairEvaluation {
  const plan = parseApprovedExecutionPlan(planInput);
  const envelope = plan.repairEnvelope;
  const reasons: string[] = [];

  if (!input.deterministic) reasons.push('failure_not_deterministic');
  if (!envelope.allowedFailureClasses.includes(input.failureClass)) {
    reasons.push('failure_class_not_allowed');
  }
  if (input.attempt > envelope.maxAttempts) reasons.push('repair_attempt_budget_exhausted');
  if (!input.retryBudgetRemaining) reasons.push('task_retry_budget_exhausted');
  if (!input.costBudgetRemaining) reasons.push('cost_budget_exhausted');
  if (!input.timeBudgetRemaining) reasons.push('time_budget_exhausted');
  if (!input.planStillSufficient) reasons.push('plan_insufficient');
  if (!input.contractStillSufficient) reasons.push('contract_insufficient');
  if (input.addsFiles && !envelope.mayAddFiles) reasons.push('new_file_not_allowed');
  if (input.changesDependencies && !envelope.mayChangeDependencies) {
    reasons.push('dependency_change_not_allowed');
  }
  if (input.changesPublicApi && !envelope.mayChangePublicApi) {
    reasons.push('public_api_change_not_allowed');
  }
  if (input.changesSchema && !envelope.mayChangeSchema) {
    reasons.push('schema_change_not_allowed');
  }
  if (input.requiresArchitectureDecision) reasons.push('architecture_decision_required');
  if (input.expandsScope) reasons.push('scope_expansion_required');
  if (input.changesRequirement) reasons.push('requirement_change_required');

  for (const path of input.changedPaths) {
    if (!envelope.pathScope.some((scope) => pathContains(scope, path))) {
      reasons.push(`path_outside_repair_scope:${path}`);
    }
  }
  const allowedOperations = new Set(plan.steps.flatMap((step) => step.allowedOperations));
  for (const operation of input.requiredOperations) {
    if (!allowedOperations.has(operation)) reasons.push(`operation_not_planned:${operation}`);
  }

  return {
    allowed: reasons.length === 0,
    decision: reasons.length === 0 ? 'repair_allowed' : 'planner_required',
    reasons,
    planId: plan.id,
    planHash: plan.hash,
  };
}

export function classifyMechanicalFailure(text: string): MechanicalFailureClass | undefined {
  if (/\bprettier\b|\bformat(?:ting)?\b/i.test(text)) return 'formatting';
  if (/\blint\b|\beslint\b/i.test(text)) return 'lint_autofix';
  if (/\btype(?:script)?\b|\btypecheck\b/i.test(text)) return 'type_annotation';
  if (/\bsnapshot\b/i.test(text)) return 'test_snapshot';
  if (/\bgenerated\b|\bcodegen\b/i.test(text)) return 'generated_artifact';
  return undefined;
}
