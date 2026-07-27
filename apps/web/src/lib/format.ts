import type { Provider } from '../types.js';

export type Tone = 'ok' | 'warn' | 'danger' | 'muted' | 'info';

const TASK_STATE_LABELS: Record<string, string> = {
  ready: 'Ready to start',
  running: 'Running',
  paused: 'Paused',
  awaiting_confirmation: 'Needs approval',
  awaiting_acceptance: 'Needs acceptance',
  succeeded: 'Completed',
  accepted: 'Accepted',
  rejected: 'Rejected',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function formatTaskState(state: string): string {
  return TASK_STATE_LABELS[state] ?? state.replaceAll('_', ' ');
}

export function taskStateTone(state: string): Tone {
  if (state === 'succeeded' || state === 'accepted') return 'ok';
  if (state === 'failed' || state === 'cancelled' || state === 'rejected') return 'danger';
  if (state === 'awaiting_confirmation' || state === 'awaiting_acceptance') return 'warn';
  if (state === 'running') return 'info';
  return 'muted';
}

const TERMINAL_STATES = new Set(['accepted', 'rejected', 'succeeded', 'failed', 'cancelled']);

export function isTerminalState(state: string): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * The active-execution projection is the last node that ran, and it is not
 * cleared when a task finishes. Once the task is terminal the task state is the
 * truth — otherwise an accepted task keeps claiming it is waiting for approval.
 */
export function formatPhase(phase: string | undefined, state: string): string {
  if (!phase || isTerminalState(state) || state === 'paused' || state === 'stopping') {
    return formatTaskState(state);
  }
  const labels: Record<string, string> = {
    reasoning: 'Thinking',
    writing: 'Writing changes',
    running_tests: 'Running verification',
    awaiting_confirmation: 'Waiting for approval',
    awaiting_acceptance: 'Waiting for acceptance',
  };
  return labels[phase] ?? phase.replaceAll('_', ' ');
}

function needsSignIn(provider: Provider): boolean {
  return (
    provider.status === 'unauthenticated' ||
    Boolean(provider.account && !provider.account.loggedIn && provider.account.supportsLogin)
  );
}

export function providerTone(provider: Provider): Tone {
  if (provider.status === 'missing' || provider.status === 'error') return 'danger';
  if (needsSignIn(provider)) return 'warn';
  if (provider.status === 'ready') return 'ok';
  return 'muted';
}

export function providerStatusLabel(provider: Provider): string {
  if (provider.status === 'missing') return 'Not installed';
  if (provider.status === 'error') return 'Error';
  if (needsSignIn(provider)) return 'Sign in required';
  if (provider.status === 'ready') return 'Ready';
  return provider.status;
}

export function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function parseJsonField(
  value: unknown,
): Record<string, unknown> | unknown[] | Record<string, never> {
  if (typeof value !== 'string') {
    return (value as Record<string, unknown> | unknown[] | undefined) ?? {};
  }
  try {
    return JSON.parse(value) as Record<string, unknown> | unknown[];
  } catch {
    return {};
  }
}

/** Actual and shadow are always shown apart — they are never one expected bill. */
export function formatUsage(usage: Record<string, unknown>): string {
  const actual = Number(usage.actualCostUsd ?? usage.actual_cost_usd ?? 0);
  const shadow = Number(usage.shadowCostUsd ?? usage.shadow_cost_usd ?? 0);
  return `$${actual.toFixed(4)} actual · $${shadow.toFixed(4)} shadow`;
}

export function downloadJson(payload: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
