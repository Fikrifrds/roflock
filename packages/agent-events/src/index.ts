import { sha256Canonical } from '@roleflock/contracts';
import { z } from 'zod';

export const AGENT_EVENT_SCHEMA_VERSION = 'agent-event-1.0.0';

const IdentifierSchema = z.string().trim().min(1).max(512);
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const CommitSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const TimestampSchema = z.string().datetime({ offset: true });
const RelativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .refine((path) => !path.startsWith('/') && !path.split('/').includes('..'), {
    message: 'Event paths must be repository-relative and cannot traverse parents',
  });

export const AGENT_FAMILIES = [
  'codex',
  'claude_code',
  'cursor',
  'opencode',
  'qwen_code',
  'kimi_code',
  'generic',
] as const;
export const AgentFamilySchema = z.enum(AGENT_FAMILIES);
export type AgentFamily = z.infer<typeof AgentFamilySchema>;

export const ExternalAgentSourceSchema = z
  .object({
    agentFamily: AgentFamilySchema,
    adapterId: IdentifierSchema,
    adapterVersion: z.string().trim().min(1).max(128),
    nativeSessionId: IdentifierSchema,
    sourceEventId: IdentifierSchema,
    providerId: IdentifierSchema.optional(),
    modelId: IdentifierSchema.optional(),
    invocationId: IdentifierSchema.optional(),
    installationId: IdentifierSchema.optional(),
  })
  .strict();
export type ExternalAgentSource = z.infer<typeof ExternalAgentSourceSchema>;

export const ExternalAgentBindingSchema = z
  .object({
    taskId: IdentifierSchema,
    contractHash: DigestSchema,
    planHash: DigestSchema,
    worktreeId: IdentifierSchema,
    worktreePathHash: DigestSchema,
    actorId: IdentifierSchema,
    baseCommit: CommitSchema,
  })
  .strict();
export type ExternalAgentBinding = z.infer<typeof ExternalAgentBindingSchema>;

const ToolReferenceSchema = z
  .object({
    callId: IdentifierSchema,
    toolName: IdentifierSchema,
    operation: IdentifierSchema,
    argumentsDigest: DigestSchema,
  })
  .strict();

export const AgentEventPayloadSchema = z.union([
  z
    .object({
      type: z.literal('session.started'),
      interactionMode: z.enum(['interactive', 'headless', 'ide']),
      resumedFromSessionId: IdentifierSchema.optional(),
      declaredRole: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('session.handoff'),
      direction: z.enum(['to_external_agent', 'to_roleflock']),
      handoffManifestHash: DigestSchema,
      reason: z.string().trim().min(1).max(2000),
    })
    .strict(),
  z
    .object({
      type: z.literal('session.ended'),
      outcome: z.enum(['completed', 'blocked', 'cancelled', 'failed', 'interrupted']),
      summaryDigest: DigestSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('tool.requested'),
      tool: ToolReferenceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('tool.completed'),
      tool: ToolReferenceSchema,
      outcome: z.enum(['succeeded', 'failed', 'denied', 'cancelled']),
      resultDigest: DigestSchema.optional(),
      durationMs: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('permission.requested'),
      requestId: IdentifierSchema,
      capability: z.enum([
        'repository_write',
        'command_execute',
        'network_access',
        'credential_access',
        'external_side_effect',
      ]),
      scopeDigest: DigestSchema,
      rationaleDigest: DigestSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('permission.decided'),
      requestId: IdentifierSchema,
      decision: z.enum(['allowed', 'denied', 'expired', 'cancelled']),
      decidedBy: IdentifierSchema,
      decisionDigest: DigestSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('file.observed'),
      operation: z.enum(['read', 'created', 'modified', 'deleted', 'renamed']),
      path: RelativePathSchema,
      destinationPath: RelativePathSchema.optional(),
      beforeDigest: DigestSchema.optional(),
      afterDigest: DigestSchema.optional(),
      planStepId: IdentifierSchema.optional(),
      bytesChanged: z.number().int().nonnegative().optional(),
    })
    .strict()
    .superRefine((payload, context) => {
      if (payload.operation === 'renamed' && !payload.destinationPath) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['destinationPath'],
          message: 'Renamed files require destinationPath',
        });
      }
      if (
        ['created', 'modified'].includes(payload.operation) &&
        payload.afterDigest === undefined
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['afterDigest'],
          message: 'Created and modified files require afterDigest',
        });
      }
      if (payload.operation === 'deleted' && payload.beforeDigest === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['beforeDigest'],
          message: 'Deleted files require beforeDigest',
        });
      }
    }),
  z
    .object({
      type: z.literal('command.started'),
      commandId: IdentifierSchema,
      argv: z.array(z.string().max(8192)).min(1).max(1024),
      argvDigest: DigestSchema,
      redactedArgumentIndexes: z.array(z.number().int().nonnegative()).max(1024),
      cwdRelative: z.union([z.literal('.'), RelativePathSchema]),
      environmentKeys: z.array(IdentifierSchema).max(512),
      planStepId: IdentifierSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('command.completed'),
      commandId: IdentifierSchema,
      exitCode: z.number().int().nullable(),
      signal: z.string().trim().min(1).optional(),
      stdoutDigest: DigestSchema.optional(),
      stderrDigest: DigestSchema.optional(),
      durationMs: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal('agent.completed'),
      status: z.enum(['completed', 'blocked', 'failed', 'cancelled']),
      resultCommit: CommitSchema.optional(),
      summaryDigest: DigestSchema,
      changedPaths: z.array(RelativePathSchema),
      reportedPlanStepIds: z.array(IdentifierSchema),
    })
    .strict(),
]);
export type AgentEventPayload = z.infer<typeof AgentEventPayloadSchema>;

const UnsealedAgentEventFields = {
  schemaVersion: z.literal(AGENT_EVENT_SCHEMA_VERSION),
  eventId: IdentifierSchema,
  source: ExternalAgentSourceSchema,
  binding: ExternalAgentBindingSchema,
  sequence: z.number().int().nonnegative(),
  previousEventHash: DigestSchema.optional(),
  occurredAt: TimestampSchema,
  receivedAt: TimestampSchema,
  payload: AgentEventPayloadSchema,
} as const;

export const UnsealedAgentEventSchema = z
  .object(UnsealedAgentEventFields)
  .strict()
  .superRefine(validateEventShape);
export type UnsealedAgentEvent = z.infer<typeof UnsealedAgentEventSchema>;

export const NormalizedAgentEventSchema = z
  .object({
    ...UnsealedAgentEventFields,
    hashAlgorithm: z.literal('sha256'),
    eventHash: DigestSchema,
  })
  .strict()
  .superRefine(validateEventShape);
export type NormalizedAgentEvent = z.infer<typeof NormalizedAgentEventSchema>;

export type AgentEventOrderingViolationCode =
  | 'EVENT_HASH_INVALID'
  | 'SOURCE_IDENTITY_CHANGED'
  | 'BINDING_CHANGED'
  | 'SEQUENCE_GAP'
  | 'PREVIOUS_HASH_MISMATCH'
  | 'TIMESTAMP_REGRESSION'
  | 'EVENT_AFTER_TERMINAL';

export interface AgentEventOrderingViolation {
  code: AgentEventOrderingViolationCode;
  reason: string;
}

export interface AgentEventOrderingDecision {
  valid: boolean;
  violations: AgentEventOrderingViolation[];
}

export function sealAgentEvent(input: UnsealedAgentEvent): NormalizedAgentEvent {
  const event = UnsealedAgentEventSchema.parse(input);
  return NormalizedAgentEventSchema.parse({
    ...event,
    hashAlgorithm: 'sha256',
    eventHash: sha256Canonical(event),
  });
}

export function verifyAgentEventHash(event: NormalizedAgentEvent): boolean {
  const parsed = NormalizedAgentEventSchema.parse(event);
  const { eventHash, hashAlgorithm: _hashAlgorithm, ...unsealed } = parsed;
  return eventHash === sha256Canonical(UnsealedAgentEventSchema.parse(unsealed));
}

export function validateAgentEventOrdering(
  previous: NormalizedAgentEvent | undefined,
  current: NormalizedAgentEvent,
): AgentEventOrderingDecision {
  const event = NormalizedAgentEventSchema.parse(current);
  const violations: AgentEventOrderingViolation[] = [];
  if (!verifyAgentEventHash(event)) {
    violation(violations, 'EVENT_HASH_INVALID', 'Event content does not match eventHash');
  }
  if (!previous) return { valid: violations.length === 0, violations };
  const prior = NormalizedAgentEventSchema.parse(previous);
  if (
    prior.source.agentFamily !== event.source.agentFamily ||
    prior.source.adapterId !== event.source.adapterId ||
    prior.source.adapterVersion !== event.source.adapterVersion ||
    prior.source.nativeSessionId !== event.source.nativeSessionId ||
    prior.source.installationId !== event.source.installationId
  ) {
    violation(
      violations,
      'SOURCE_IDENTITY_CHANGED',
      'Source family, adapter version, session, and installation identity are immutable within a stream',
    );
  }
  if (sha256Canonical(prior.binding) !== sha256Canonical(event.binding)) {
    violation(
      violations,
      'BINDING_CHANGED',
      'Task, authority, worktree, actor, and base commit binding changed within a stream',
    );
  }
  if (event.sequence !== prior.sequence + 1) {
    violation(
      violations,
      'SEQUENCE_GAP',
      `Expected sequence ${prior.sequence + 1}, received ${event.sequence}`,
    );
  }
  if (event.previousEventHash !== prior.eventHash) {
    violation(
      violations,
      'PREVIOUS_HASH_MISMATCH',
      'previousEventHash does not reference the immediately preceding event',
    );
  }
  if (Date.parse(event.occurredAt) < Date.parse(prior.occurredAt)) {
    violation(
      violations,
      'TIMESTAMP_REGRESSION',
      'occurredAt cannot move backwards within a source stream',
    );
  }
  if (isTerminal(prior.payload.type)) {
    violation(
      violations,
      'EVENT_AFTER_TERMINAL',
      `No event may follow terminal payload ${prior.payload.type}`,
    );
  }
  return { valid: violations.length === 0, violations };
}

function validateEventShape(
  event: z.infer<z.ZodObject<typeof UnsealedAgentEventFields>>,
  context: z.RefinementCtx,
): void {
  if (event.sequence === 0 && event.previousEventHash !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['previousEventHash'],
      message: 'The first event cannot claim a previous hash',
    });
  }
  if (event.sequence > 0 && event.previousEventHash === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['previousEventHash'],
      message: 'Events after sequence zero require previousEventHash',
    });
  }
  if (event.sequence === 0 && event.payload.type !== 'session.started') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['payload', 'type'],
      message: 'A stream must begin with session.started',
    });
  }
  if (event.sequence > 0 && event.payload.type === 'session.started') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['payload', 'type'],
      message: 'session.started is only valid at sequence zero',
    });
  }
  if (event.payload.type === 'command.started') {
    const uniqueIndexes = new Set(event.payload.redactedArgumentIndexes);
    if (uniqueIndexes.size !== event.payload.redactedArgumentIndexes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payload', 'redactedArgumentIndexes'],
        message: 'Redacted argument indexes must be unique',
      });
    }
    for (const index of uniqueIndexes) {
      if (index >= event.payload.argv.length || event.payload.argv[index] !== '[REDACTED]') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['payload', 'redactedArgumentIndexes'],
          message: 'Every redacted index must point to a [REDACTED] argv placeholder',
        });
      }
    }
  }
}

function isTerminal(type: AgentEventPayload['type']): boolean {
  return type === 'session.ended' || type === 'agent.completed';
}

function violation(
  violations: AgentEventOrderingViolation[],
  code: AgentEventOrderingViolationCode,
  reason: string,
): void {
  violations.push({ code, reason });
}

export * from './jsonl.js';
export * from './adapters/codex.js';
export * from './adapters/claude-code.js';
export * from './adapters/cursor.js';
export * from './assurance.js';
