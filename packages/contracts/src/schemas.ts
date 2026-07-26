import { z } from 'zod';

export const RiskClassSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskClass = z.infer<typeof RiskClassSchema>;

export const TaskTypeSchema = z.enum([
  'new_product',
  'feature',
  'bug_fix',
  'refactor',
  'test_improvement',
  'performance',
  'security_fix',
  'documentation',
  'dependency_update',
  'migration',
  'investigation',
  'review_changes',
]);
export type TaskType = z.infer<typeof TaskTypeSchema>;

export const TaskStateSchema = z.enum([
  'draft',
  'ready',
  'running',
  'awaiting_confirmation',
  'paused',
  'stopping',
  'failed',
  'awaiting_acceptance',
  'accepted',
  'rejected',
  'cancelled',
]);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const ExecutionPhaseSchema = z.enum([
  'preparing',
  'compiling_context',
  'waiting_for_provider',
  'reasoning',
  'reading',
  'writing',
  'running_tool',
  'running_tests',
  'awaiting_confirmation',
  'stopping',
  'recovering',
  'finalising',
]);
export type ExecutionPhase = z.infer<typeof ExecutionPhaseSchema>;

export const UsageConfidenceSchema = z.enum([
  'exact',
  'provider_reported',
  'estimated',
  'unknown',
]);
export type UsageConfidence = z.infer<typeof UsageConfidenceSchema>;

export const ConfirmationRequestTypeSchema = z.enum([
  'clarify_requirement',
  'expand_scope',
  'write_path',
  'run_command',
  'network_access',
  'dependency_change',
  'database_change',
  'external_side_effect',
  'provider_switch',
  'additional_budget',
  'policy_exception',
]);
export type ConfirmationRequestType = z.infer<typeof ConfirmationRequestTypeSchema>;

export const ConfirmationStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'expired',
  'invalidated',
]);
export type ConfirmationStatus = z.infer<typeof ConfirmationStatusSchema>;

export const ApprovalGrantScopeSchema = z.enum([
  'single_request',
  'node_attempt',
  'task',
  'task_request_type',
  'repository_session',
  'exact_fingerprint',
]);
export type ApprovalGrantScope = z.infer<typeof ApprovalGrantScopeSchema>;

export const StructuredActionSchema = z.object({
  kind: z.string(),
  verb: z.string(),
  target: z.string().optional(),
  paths: z.array(z.string()).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  destination: z.string().optional(),
  sideEffectClass: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type StructuredAction = z.infer<typeof StructuredActionSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  type: TaskTypeSchema,
  title: z.string(),
  brief: z.string(),
  risk: RiskClassSchema,
  state: TaskStateSchema,
  workflowGraphVersionId: z.string(),
  budgetPolicyId: z.string(),
  expectedBehaviour: z.string().optional(),
  actualBehaviour: z.string().optional(),
  maxAttempts: z.number().int().positive().default(3),
  maxActualCostUsd: z.number().nonnegative().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const ActiveExecutionSchema = z.object({
  graphRunId: z.string(),
  nodeRunId: z.string(),
  taskId: z.string(),
  roleId: z.string(),
  roleDisplayName: z.string(),
  providerConnectionId: z.string(),
  providerDisplayName: z.string(),
  configuredModelId: z.string(),
  configuredModelDisplayName: z.string(),
  effort: z.string().optional(),
  phase: ExecutionPhaseSchema,
  permissionProfileId: z.string(),
  currentActivity: z.string().optional(),
  activeTool: z.string().optional(),
  activeCommandPreview: z.string().optional(),
  startedAt: z.string(),
  lastHeartbeatAt: z.string(),
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  actualCost: z.number().optional(),
  shadowCost: z.number().optional(),
  usageConfidence: UsageConfidenceSchema,
  pauseRequested: z.boolean(),
  stopRequested: z.boolean(),
  forceTerminationAvailable: z.boolean(),
});
export type ActiveExecution = z.infer<typeof ActiveExecutionSchema>;

export const ConfirmationRequestSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  graphRunId: z.string(),
  nodeRunId: z.string(),
  requestType: ConfirmationRequestTypeSchema,
  rationale: z.string(),
  exactAction: StructuredActionSchema,
  affectedPaths: z.array(z.string()).optional(),
  commandPreview: z.string().optional(),
  destination: z.string().optional(),
  estimatedAdditionalCost: z.number().optional(),
  riskClass: RiskClassSchema,
  stateHash: z.string(),
  fingerprint: z.string(),
  status: ConfirmationStatusSchema,
  createdAt: z.string(),
});
export type ConfirmationRequest = z.infer<typeof ConfirmationRequestSchema>;

export const ApprovalGrantSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  scope: ApprovalGrantScopeSchema,
  fingerprint: z.string().optional(),
  requestTypes: z.array(z.string()).optional(),
  allowedPathPatterns: z.array(z.string()).optional(),
  allowedCommandTemplates: z.array(z.string()).optional(),
  allowedDestinations: z.array(z.string()).optional(),
  maximumRisk: z.enum(['low', 'medium', 'high']),
  maximumAdditionalCost: z.number().optional(),
  maximumApplications: z.number().int().positive().optional(),
  applicationsUsed: z.number().int().nonnegative(),
  expiresAt: z.string(),
  revokedAt: z.string().optional(),
  createdBy: z.string(),
});
export type ApprovalGrant = z.infer<typeof ApprovalGrantSchema>;

export const EventEnvelopeSchema = z.object({
  id: z.string(),
  aggregateType: z.string(),
  aggregateId: z.string(),
  sequence: z.number().int().nonnegative(),
  eventType: z.string(),
  payload: z.record(z.unknown()),
  metadata: z
    .object({
      schemaVersion: z.number().int().positive().default(1),
      actorId: z.string().optional(),
      causationId: z.string().optional(),
      correlationId: z.string().optional(),
      idempotencyKey: z.string().optional(),
    })
    .passthrough(),
  createdAt: z.string(),
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

export const InvocationEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('invocation.started'), invocationId: z.string() }),
  z.object({ type: z.literal('model.output.delta'), text: z.string() }),
  z.object({
    type: z.literal('phase.changed'),
    phase: ExecutionPhaseSchema,
    detail: z.string().optional(),
  }),
  z.object({ type: z.literal('heartbeat'), at: z.string() }),
  z.object({ type: z.literal('tool.requested'), tool: z.string(), input: z.unknown() }),
  z.object({ type: z.literal('tool.started'), tool: z.string() }),
  z.object({
    type: z.literal('tool.completed'),
    tool: z.string(),
    outputRef: z.string().optional(),
  }),
  z.object({
    type: z.literal('confirmation.requested'),
    request: z.record(z.unknown()),
  }),
  z.object({ type: z.literal('usage.updated'), usage: z.record(z.unknown()) }),
  z.object({ type: z.literal('quota.updated'), quota: z.record(z.unknown()) }),
  z.object({ type: z.literal('invocation.interrupted'), reason: z.string() }),
  z.object({ type: z.literal('invocation.completed'), output: z.unknown() }),
  z.object({
    type: z.literal('invocation.failed'),
    error: z.object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean().optional(),
      details: z.unknown().optional(),
    }),
  }),
]);
export type InvocationEvent = z.infer<typeof InvocationEventSchema>;

export const CreateTaskCommandSchema = z.object({
  projectId: z.string(),
  type: TaskTypeSchema,
  title: z.string().min(1),
  brief: z.string().min(1),
  risk: RiskClassSchema.default('medium'),
  expectedBehaviour: z.string().optional(),
  actualBehaviour: z.string().optional(),
  maxAttempts: z.number().int().positive().default(3),
  maxActualCostUsd: z.number().nonnegative().optional(),
  idempotencyKey: z.string().optional(),
});
export type CreateTaskCommand = z.infer<typeof CreateTaskCommandSchema>;

export const CreateProjectCommandSchema = z.object({
  name: z.string().min(1),
  repositoryPath: z.string().min(1),
  baseBranch: z.string().default('main'),
  idempotencyKey: z.string().optional(),
});
export type CreateProjectCommand = z.infer<typeof CreateProjectCommandSchema>;

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  product: z.literal('RoleFlock'),
  version: z.string(),
  host: z.string(),
  port: z.number(),
  uptimeMs: z.number(),
  pid: z.number(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ROLEFLOCK_VERSION = '0.1.0';
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4178;
