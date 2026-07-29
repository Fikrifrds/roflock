import { sha256Canonical } from '@roleflock/contracts';
import { z } from 'zod';
import {
  type AgentEventPayload,
  type ExternalAgentBinding,
  sealAgentEvent,
  type NormalizedAgentEvent,
} from '../index.js';

export const CURSOR_ADAPTER_ID = 'roleflock.cursor-stream-json';
export const CURSOR_ADAPTER_VERSION = '1.0.0';

const CursorStreamEventSchema = z
  .object({
    type: z.enum(['system', 'user', 'assistant', 'tool_call', 'result']),
    subtype: z.string().optional(),
    session_id: z.string().min(1),
    cwd: z.string().optional(),
    model: z.string().optional(),
    call_id: z.string().optional(),
    tool_call: z.unknown().optional(),
    is_error: z.boolean().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    result: z.unknown().optional(),
    request_id: z.string().optional(),
  })
  .passthrough();
export type CursorStreamEvent = z.infer<typeof CursorStreamEventSchema>;

export interface CursorAdapterContext {
  binding: ExternalAgentBinding;
  workspacePath: string;
  declaredRole: string;
  installationId: string;
  firstSequence?: number;
  previousEventHash?: string;
  receivedAt: string;
}

export function adaptCursorStream(
  input: string | readonly unknown[],
  context: CursorAdapterContext,
): NormalizedAgentEvent[] {
  const rawEvents = typeof input === 'string' ? parseLines(input) : [...input];
  const nativeEvents = rawEvents.map((event) => CursorStreamEventSchema.parse(event));
  const init = nativeEvents.find((event) => event.type === 'system' && event.subtype === 'init');
  if (!init?.cwd) throw new Error('Cursor stream requires a system/init event with cwd');
  if (normalizePath(init.cwd) !== normalizePath(context.workspacePath)) {
    throw new Error(
      `Cursor stream cwd ${init.cwd} does not match pinned worktree ${context.workspacePath}`,
    );
  }
  if (nativeEvents.some((event) => event.session_id !== init.session_id)) {
    throw new Error('Cursor stream cannot mix native session ids');
  }

  const adapted: NormalizedAgentEvent[] = [];
  let sequence = context.firstSequence ?? 0;
  let previousEventHash = context.previousEventHash;
  for (const native of nativeEvents) {
    const eventPayload = cursorPayload(native, context, sequence);
    if (!eventPayload) continue;
    const sourceEventId = cursorSourceId(native);
    const occurredAt = new Date(Date.parse(context.receivedAt) + adapted.length).toISOString();
    const event = sealAgentEvent({
      schemaVersion: 'agent-event-1.0.0',
      eventId: `${native.session_id}:${sourceEventId}`,
      source: {
        agentFamily: 'cursor',
        adapterId: CURSOR_ADAPTER_ID,
        adapterVersion: CURSOR_ADAPTER_VERSION,
        nativeSessionId: native.session_id,
        sourceEventId,
        providerId: 'cursor',
        modelId: init.model,
        invocationId: native.request_id,
        installationId: context.installationId,
      },
      binding: context.binding,
      sequence,
      ...(previousEventHash ? { previousEventHash } : {}),
      occurredAt,
      receivedAt: context.receivedAt,
      payload: eventPayload,
    });
    adapted.push(event);
    sequence += 1;
    previousEventHash = event.eventHash;
  }
  if (adapted.length === 0) throw new Error('Cursor stream contains no assurance events');
  return adapted;
}

function cursorPayload(
  event: CursorStreamEvent,
  context: CursorAdapterContext,
  sequence: number,
): AgentEventPayload | undefined {
  if (event.type === 'system' && event.subtype === 'init') {
    return sequence === 0
      ? {
          type: 'session.started',
          interactionMode: 'headless',
          declaredRole: context.declaredRole,
        }
      : {
          type: 'session.handoff',
          direction: 'to_external_agent',
          handoffManifestHash: sha256Canonical(context.binding),
          reason: 'Cursor session resumed',
        };
  }
  if (event.type === 'tool_call' && event.call_id && event.tool_call) {
    const { name, content } = toolEnvelope(event.tool_call);
    const reference = {
      callId: event.call_id,
      toolName: name,
      operation: name,
      argumentsDigest: sha256Canonical(content),
    };
    return event.subtype === 'started'
      ? { type: 'tool.requested', tool: reference }
      : event.subtype === 'completed'
        ? {
            type: 'tool.completed',
            tool: reference,
            outcome: event.is_error ? 'failed' : 'succeeded',
            resultDigest: sha256Canonical(content),
          }
        : undefined;
  }
  if (event.type === 'result') {
    return {
      type: 'session.ended',
      outcome: event.is_error ? 'failed' : 'completed',
      ...(event.result === undefined ? {} : { summaryDigest: sha256Canonical(event.result) }),
    };
  }
  return undefined;
}

function cursorSourceId(event: CursorStreamEvent): string {
  if (event.type === 'system') return `system:${event.subtype ?? 'unknown'}`;
  if (event.type === 'tool_call') {
    return `tool:${event.subtype ?? 'unknown'}:${event.call_id ?? 'unknown'}`;
  }
  return `result:${event.request_id ?? sha256Canonical(event).slice(0, 24)}`;
}

function toolEnvelope(value: unknown): { name: string; content: unknown } {
  if (typeof value !== 'object' || value === null) return { name: 'unknown', content: value };
  const [entry] = Object.entries(value);
  return entry ? { name: entry[0], content: entry[1] } : { name: 'unknown', content: value };
}

function parseLines(input: string): unknown[] {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) throw new Error('Cursor stream JSONL is empty');
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid Cursor stream JSON on line ${index + 1}`, { cause: error });
    }
  });
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '');
}
