import { sha256Canonical } from '@roleflock/contracts';
import { z } from 'zod';
import {
  type AgentEventPayload,
  type ExternalAgentBinding,
  sealAgentEvent,
  type NormalizedAgentEvent,
} from '../index.js';

export const CLAUDE_CODE_ADAPTER_ID = 'roleflock.claude-code-hooks';
export const CLAUDE_CODE_ADAPTER_VERSION = '1.0.0';

const ClaudeCommon = {
  session_id: z.string().min(1),
  transcript_path: z.string().optional(),
  cwd: z.string().min(1),
  permission_mode: z.string().optional(),
} as const;

export const ClaudeCodeHookInputSchema = z.discriminatedUnion('hook_event_name', [
  z.object({
    ...ClaudeCommon,
    hook_event_name: z.literal('SessionStart'),
    source: z.enum(['startup', 'resume', 'clear']),
  }).passthrough(),
  z.object({
    ...ClaudeCommon,
    hook_event_name: z.literal('PreToolUse'),
    tool_name: z.string().min(1),
    tool_use_id: z.string().min(1),
    tool_input: z.unknown(),
  }).passthrough(),
  z.object({
    ...ClaudeCommon,
    hook_event_name: z.literal('PermissionRequest'),
    tool_name: z.string().min(1),
    tool_use_id: z.string().optional(),
    tool_input: z.unknown(),
  }).passthrough(),
  z.object({
    ...ClaudeCommon,
    hook_event_name: z.literal('PostToolUse'),
    tool_name: z.string().min(1),
    tool_use_id: z.string().min(1),
    tool_input: z.unknown(),
    tool_response: z.unknown(),
  }).passthrough(),
  z.object({
    ...ClaudeCommon,
    hook_event_name: z.literal('Stop'),
    stop_hook_active: z.boolean(),
    last_assistant_message: z.string().optional(),
  }).passthrough(),
]);
export type ClaudeCodeHookInput = z.infer<typeof ClaudeCodeHookInputSchema>;

export interface ClaudeCodeAdapterContext {
  binding: ExternalAgentBinding;
  workspacePath: string;
  declaredRole: string;
  sequence: number;
  previousEventHash?: string;
  occurredAt: string;
  receivedAt?: string;
  installationId: string;
  modelId?: string;
}

export function adaptClaudeCodeHook(
  raw: unknown,
  context: ClaudeCodeAdapterContext,
): NormalizedAgentEvent {
  const input = ClaudeCodeHookInputSchema.parse(raw);
  if (normalizePath(input.cwd) !== normalizePath(context.workspacePath)) {
    throw new Error(
      `Claude Code hook cwd ${input.cwd} does not match pinned worktree ${context.workspacePath}`,
    );
  }
  const sourceEventId = sourceId(input);
  return sealAgentEvent({
    schemaVersion: 'agent-event-1.0.0',
    eventId: `${input.session_id}:${sourceEventId}`,
    source: {
      agentFamily: 'claude_code',
      adapterId: CLAUDE_CODE_ADAPTER_ID,
      adapterVersion: CLAUDE_CODE_ADAPTER_VERSION,
      nativeSessionId: input.session_id,
      sourceEventId,
      providerId: 'anthropic',
      modelId: context.modelId,
      installationId: context.installationId,
    },
    binding: context.binding,
    sequence: context.sequence,
    ...(context.previousEventHash ? { previousEventHash: context.previousEventHash } : {}),
    occurredAt: context.occurredAt,
    receivedAt: context.receivedAt ?? new Date().toISOString(),
    payload: payload(input, context),
  });
}

function payload(
  input: ClaudeCodeHookInput,
  context: ClaudeCodeAdapterContext,
): AgentEventPayload {
  switch (input.hook_event_name) {
    case 'SessionStart':
      return context.sequence === 0
        ? {
            type: 'session.started',
            interactionMode: 'interactive',
            ...(input.source === 'resume' ? { resumedFromSessionId: input.session_id } : {}),
            declaredRole: context.declaredRole,
          }
        : {
            type: 'session.handoff',
            direction: 'to_external_agent',
            handoffManifestHash: sha256Canonical(context.binding),
            reason: `Claude Code session ${input.source}`,
          };
    case 'PreToolUse':
      return {
        type: 'tool.requested',
        tool: tool(input.tool_use_id, input.tool_name, input.tool_input),
      };
    case 'PermissionRequest':
      return {
        type: 'permission.requested',
        requestId: input.tool_use_id ?? `${input.session_id}:${input.tool_name}`,
        capability: input.tool_name === 'Bash' ? 'command_execute' : 'repository_write',
        scopeDigest: sha256Canonical(input.tool_input),
        rationaleDigest: sha256Canonical('Claude Code permission request'),
      };
    case 'PostToolUse':
      return {
        type: 'tool.completed',
        tool: tool(input.tool_use_id, input.tool_name, input.tool_input),
        outcome: 'succeeded',
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

function tool(callId: string, toolName: string, toolInput: unknown) {
  return {
    callId,
    toolName,
    operation: toolName === 'Bash' ? 'command' : toolName,
    argumentsDigest: sha256Canonical(toolInput),
  };
}

function sourceId(input: ClaudeCodeHookInput): string {
  if ('tool_use_id' in input && typeof input.tool_use_id === 'string') {
    return `${input.hook_event_name}:${input.tool_use_id}`;
  }
  if (input.hook_event_name === 'SessionStart') {
    return `${input.hook_event_name}:${input.source}`;
  }
  return `${input.hook_event_name}:${sha256Canonical(input).slice(0, 24)}`;
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '');
}
