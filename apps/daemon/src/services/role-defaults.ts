import type { RoleCandidateInput } from '@roleflock/database';

export const ROUTED_ROLES = ['planner', 'reviewer', 'writer', 'verifier'] as const;
export type RoutedRole = (typeof ROUTED_ROLES)[number];

export const ROLE_LABELS: Record<RoutedRole, string> = {
  planner: 'Planner / lead',
  writer: 'Executor',
  reviewer: 'Reviewer',
  verifier: 'Verifier',
};

export const ROLE_DESCRIPTIONS: Record<RoutedRole, string> = {
  planner: 'Reads the repository and proposes the change. Never writes.',
  writer: 'Makes the change inside the leased worktree. The only role that writes.',
  reviewer: 'Judges the proposed scope before any file is touched.',
  verifier: 'Checks the finished change and can send it back to the executor.',
};

/**
 * Shipping defaults.
 *
 * Each role is an ordered preference list, and the second entry exists for one
 * reason: subscription quota runs out mid-task. Where possible the fallback is
 * the *same* model reached through a different provider — `gpt-5.6-sol` is
 * available both as a Cursor catalogue entry and as a Codex model with its own
 * quota — so an exhausted plan costs the run a provider, not its quality.
 *
 * Cursor encodes effort in the model id; Codex and Claude take it as a separate
 * setting. Both spellings appear below because both are what those CLIs expect.
 *
 * The fake provider is deliberately absent. If every candidate refuses, the run
 * stops and says which provider said what — fabricating plausible output when a
 * real model was asked for would hide exactly the thing the operator needs to
 * act on. `ROLEFLOCK_FORCE_FAKE=1` is the explicit way to run without a CLI.
 */
export const DEFAULT_ROLE_ASSIGNMENTS: Record<RoutedRole, RoleCandidateInput[]> = {
  planner: [
    { providerConnectionId: 'cursor', modelId: 'claude-opus-5-high', effort: 'high' },
    { providerConnectionId: 'cursor', modelId: 'gpt-5.6-sol-high', effort: 'high' },
    { providerConnectionId: 'codex', modelId: 'gpt-5.6-sol', effort: 'high' },
    { providerConnectionId: 'claude', modelId: 'opus', effort: 'high' },
  ],
  writer: [
    { providerConnectionId: 'cursor', modelId: 'cursor-grok-4.5-high', effort: 'high' },
    { providerConnectionId: 'cursor', modelId: 'claude-opus-5-high', effort: 'high' },
    { providerConnectionId: 'codex', modelId: 'gpt-5.6-sol', effort: 'high' },
    { providerConnectionId: 'cursor', modelId: 'composer-2.5', effort: 'medium' },
  ],
  reviewer: [
    { providerConnectionId: 'cursor', modelId: 'gpt-5.6-terra-medium', effort: 'medium' },
    { providerConnectionId: 'cursor', modelId: 'claude-opus-5-low', effort: 'low' },
    { providerConnectionId: 'codex', modelId: 'gpt-5.6-terra', effort: 'medium' },
  ],
  verifier: [
    { providerConnectionId: 'cursor', modelId: 'gpt-5.6-terra-high', effort: 'high' },
    { providerConnectionId: 'cursor', modelId: 'claude-opus-5-medium', effort: 'medium' },
    { providerConnectionId: 'codex', modelId: 'gpt-5.6-terra', effort: 'high' },
  ],
};

export function isRoutedRole(value: string): value is RoutedRole {
  return (ROUTED_ROLES as readonly string[]).includes(value);
}
