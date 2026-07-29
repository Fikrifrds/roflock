import type { NormalizedAgentEvent } from './index.js';

export type TelemetryAssuranceLevel = 'complete' | 'partial' | 'unobserved';

export interface TelemetryExpectation {
  requireTerminalEvent: boolean;
  requireToolLifecycle: boolean;
  requireFileTelemetry: boolean;
  requireCommandTelemetry: boolean;
}

export interface TelemetryAssuranceGap {
  code:
    | 'NO_TELEMETRY'
    | 'SESSION_NOT_TERMINAL'
    | 'UNMATCHED_TOOL_REQUEST'
    | 'TOOL_COMPLETION_WITHOUT_REQUEST'
    | 'FILE_TELEMETRY_MISSING'
    | 'COMMAND_TELEMETRY_MISSING';
  severity: 'warning' | 'blocking';
  message: string;
}

export interface TelemetryAssuranceReport {
  level: TelemetryAssuranceLevel;
  observedEventCount: number;
  gaps: TelemetryAssuranceGap[];
  reentry: {
    required: boolean;
    owner: 'planner';
    action: 'continue_execution' | 'review_assurance_gap';
    reason: string;
  };
}

export const EXECUTOR_TELEMETRY_EXPECTATION: TelemetryExpectation = {
  requireTerminalEvent: true,
  requireToolLifecycle: true,
  requireFileTelemetry: true,
  requireCommandTelemetry: true,
};

export function calculateTelemetryAssurance(
  events: readonly NormalizedAgentEvent[],
  expectation: TelemetryExpectation = EXECUTOR_TELEMETRY_EXPECTATION,
): TelemetryAssuranceReport {
  const gaps: TelemetryAssuranceGap[] = [];
  if (events.length === 0) {
    gaps.push({
      code: 'NO_TELEMETRY',
      severity: 'blocking',
      message: 'No external-agent telemetry was observed for this handoff.',
    });
    return report('unobserved', events.length, gaps);
  }
  const terminal = events.some(
    (event) =>
      event.payload.type === 'session.ended' || event.payload.type === 'agent.completed',
  );
  if (expectation.requireTerminalEvent && !terminal) {
    gaps.push({
      code: 'SESSION_NOT_TERMINAL',
      severity: 'warning',
      message: 'The external session has no terminal event; its outcome is still unknown.',
    });
  }
  if (expectation.requireToolLifecycle) inspectTools(events, gaps);
  if (
    expectation.requireFileTelemetry &&
    !events.some((event) => event.payload.type === 'file.observed')
  ) {
    gaps.push({
      code: 'FILE_TELEMETRY_MISSING',
      severity: 'warning',
      message: 'File-level telemetry is unavailable; changed-path adherence must be re-verified.',
    });
  }
  if (
    expectation.requireCommandTelemetry &&
    !events.some(
      (event) =>
        event.payload.type === 'command.started' || event.payload.type === 'command.completed',
    )
  ) {
    gaps.push({
      code: 'COMMAND_TELEMETRY_MISSING',
      severity: 'warning',
      message: 'Command-level telemetry is unavailable; test execution cannot be inferred.',
    });
  }
  return report(gaps.length === 0 ? 'complete' : 'partial', events.length, gaps);
}

function inspectTools(
  events: readonly NormalizedAgentEvent[],
  gaps: TelemetryAssuranceGap[],
): void {
  const requested = new Set<string>();
  const completed = new Set<string>();
  for (const event of events) {
    if (event.payload.type === 'tool.requested') requested.add(event.payload.tool.callId);
    if (event.payload.type === 'tool.completed') completed.add(event.payload.tool.callId);
  }
  for (const callId of requested) {
    if (!completed.has(callId)) {
      gaps.push({
        code: 'UNMATCHED_TOOL_REQUEST',
        severity: 'warning',
        message: `Tool call ${callId} has no observed completion.`,
      });
    }
  }
  for (const callId of completed) {
    if (!requested.has(callId)) {
      gaps.push({
        code: 'TOOL_COMPLETION_WITHOUT_REQUEST',
        severity: 'warning',
        message: `Tool call ${callId} completed without an observed request.`,
      });
    }
  }
}

function report(
  level: TelemetryAssuranceLevel,
  observedEventCount: number,
  gaps: TelemetryAssuranceGap[],
): TelemetryAssuranceReport {
  const required = gaps.length > 0;
  return {
    level,
    observedEventCount,
    gaps,
    reentry: {
      required,
      owner: 'planner',
      action: required ? 'review_assurance_gap' : 'continue_execution',
      reason: required
        ? 'Planner must decide whether to collect evidence, revise verification, or accept an explicit caveat.'
        : 'External evidence is complete for the declared telemetry expectation.',
    },
  };
}
