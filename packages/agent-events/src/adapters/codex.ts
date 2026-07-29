import { sha256Canonical } from '@roleflock/contracts';
import { z } from 'zod';
import {
  type AgentEventPayload,
  type ExternalAgentBinding,
  sealAgentEvent,
  type NormalizedAgentEvent,
} from '../index.js';

export const CODEX_ADAPTER_ID = 'roleflock.codex-hooks';
export const CODEX_ADAPTER_VERSION = '1.0.0';

const CommonFields = {
  session_id: z.string().min(1),
  transcript_path: z.string().nullable().optional(),
  cwd: z.string().min(1),
  hook_event_name: z.string().min(1),
  model: z.string().min(1),
  permission_mode: z.string().min(1).optional(),
} as const;

export const CodexHookInputSchema = z.discriminatedUnion('hook_event_name', [
  z
    .object({
      ...CommonFields,
      hook_event_name: z.literal('SessionStart'),
      source: z.enum(['startup', 'resume', 'clear', 'compact']),
    })
    .passthrough(),
  z
    .object({
      ...CommonFields,
      hook_event_name: z.literal('PreToolUse'),
      turn_id: z.string().min(1),
      tool_name: z.string().min(1),
      tool_use_id: z.string().min(1),
      tool_input: z.unknown(),
    })
    .passthrough(),
  z
    .object({
      ...CommonFields,
      hook_event_name: z.literal('PermissionRequest'),
      turn_id: z.string().min(1),
      tool_name: z.string().min(1),
      tool_input: z.unknown(),
    })
    .passthrough(),
  z
    .object({
      ...CommonFields,
      hook_event_name: z.literal('PostToolUse'),
      turn_id: z.string().min(1),
      tool_name: z.string().min(1),
      tool_use_id: z.string().min(1),
      tool_input: z.unknown(),
      tool_response: z.unknown(),
    })
    .passthrough(),
  z
    .object({
      ...CommonFields,
      hook_event_name: z.literal('Stop'),
      turn_id: z.string().min(1),
      stop_hook_active: z.boolean(),
      last_assistant_message: z.string().nullable(),
    })
    .passthrough(),
]);
export type CodexHookInput = z.infer<typeof CodexHookInputSchema>;

export interface CodexAdapterContext {
  binding: ExternalAgentBinding;
  workspacePath: string;
  declaredRole: string;
  sequence: number;
  previousEventHash?: string;
  occurredAt: string;
  receivedAt?: string;
  installationId: string;
}

export function adaptCodexHook(raw: unknown, context: CodexAdapterContext): NormalizedAgentEvent {
  const input = CodexHookInputSchema.parse(raw);
  if (normalizePath(input.cwd) !== normalizePath(context.workspacePath)) {
    throw new Error(
      `Codex hook cwd ${input.cwd} does not match pinned worktree ${context.workspacePath}`,
    );
  }
  const sourceEventId = codexSourceEventId(input);
  return sealAgentEvent({
    schemaVersion: 'agent-event-1.0.0',
    eventId: `${input.session_id}:${sourceEventId}`,
    source: {
      agentFamily: 'codex',
      adapterId: CODEX_ADAPTER_ID,
      adapterVersion: CODEX_ADAPTER_VERSION,
      nativeSessionId: input.session_id,
      sourceEventId,
      providerId: 'openai',
      modelId: input.model,
      invocationId:
        'turn_id' in input && typeof input.turn_id === 'string' ? input.turn_id : undefined,
      installationId: context.installationId,
    },
    binding: context.binding,
    sequence: context.sequence,
    ...(context.previousEventHash ? { previousEventHash: context.previousEventHash } : {}),
    occurredAt: context.occurredAt,
    receivedAt: context.receivedAt ?? new Date().toISOString(),
    payload: codexPayload(input, context),
  });
}

function codexPayload(input: CodexHookInput, context: CodexAdapterContext): AgentEventPayload {
  switch (input.hook_event_name) {
    case 'SessionStart':
      if (context.sequence > 0) {
        return {
          type: 'session.handoff',
          direction: 'to_external_agent',
          handoffManifestHash: sha256Canonical(context.binding),
          reason: `Codex session ${input.source}`,
        };
      }
      return {
        type: 'session.started',
        interactionMode: 'interactive',
        ...(input.source === 'resume' ? { resumedFromSessionId: input.session_id } : {}),
        declaredRole: context.declaredRole,
      };
    case 'PreToolUse':
      return {
        type: 'tool.requested',
        tool: toolReference(input.tool_use_id, input.tool_name, input.tool_input),
      };
    case 'PermissionRequest':
      return {
        type: 'permission.requested',
        requestId: `${input.turn_id}:${input.tool_name}`,
        capability: capabilityFor(input.tool_name),
        scopeDigest: sha256Canonical(input.tool_input),
        rationaleDigest: sha256Canonical(
          objectValue(input.tool_input)?.description ?? 'Codex permission request',
        ),
      };
    case 'PostToolUse':
      return {
        type: 'tool.completed',
        tool: toolReference(input.tool_use_id, input.tool_name, input.tool_input),
        outcome: toolOutcome(input.tool_response),
        resultDigest: sha256Canonical(input.tool_response),
      };
    case 'Stop':
      return {
        type: 'session.ended',
        outcome: input.stop_hook_active ? 'interrupted' : 'completed',
        ...(input.last_assistant_message
          ? { summaryDigest: sha256Canonical(input.last_assistant_message) }
          : {}),
      };
  }
}

function toolReference(callId: string, toolName: string, toolInput: unknown) {
  return {
    callId,
    toolName,
    operation: toolName === 'Bash' ? 'command' : toolName,
    argumentsDigest: sha256Canonical(toolInput),
  };
}

function codexSourceEventId(input: CodexHookInput): string {
  if ('tool_use_id' in input) return `${input.hook_event_name}:${input.tool_use_id}`;
  if ('turn_id' in input) return `${input.hook_event_name}:${input.turn_id}`;
  return `${input.hook_event_name}:${input.source}`;
}

function capabilityFor(
  toolName: string,
):
  | 'repository_write'
  | 'command_execute'
  | 'network_access'
  | 'credential_access'
  | 'external_side_effect' {
  return toolName === 'Bash'
    ? 'command_execute'
    : toolName === 'apply_patch'
      ? 'repository_write'
      : toolName.startsWith('mcp__')
        ? 'external_side_effect'
        : 'repository_write';
}

function toolOutcome(response: unknown): 'succeeded' | 'failed' {
  const value = objectValue(response);
  return value?.isError === true || value?.exit_code
    ? Number(value.exit_code ?? 1) === 0
      ? 'succeeded'
      : 'failed'
    : 'succeeded';
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '');
}
