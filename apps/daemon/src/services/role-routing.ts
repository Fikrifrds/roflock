import { randomUUID } from 'node:crypto';
import {
  AuditRepository,
  ProviderCooldownRepository,
  RoleAssignmentRepository,
  type RoleCandidate,
  type RoleCandidateInput,
  type SqliteDb,
} from '@roleflock/database';
import {
  isEffort,
  type Effort,
  type ProviderAdapter,
  type ProviderFailureKind,
} from '@roleflock/provider-core';
import { DEFAULT_ROLE_ASSIGNMENTS, ROUTED_ROLES, type RoutedRole } from './role-defaults.js';
import type { ProviderRegistry } from './provider-registry.js';

export type { RoutedRole };

export interface SkippedCandidate {
  providerId: string;
  modelId: string;
  reason: 'disabled' | 'unknown_provider' | 'unhealthy' | 'cooling_down';
  detail?: string;
}

export interface RoleRoute {
  role: RoutedRole;
  providerId: string;
  providerDisplayName: string;
  modelId: string;
  modelDisplayName: string;
  effort?: Effort;
  adapter: ProviderAdapter;
  /** True when an earlier candidate could not serve this turn. */
  fallbackUsed: boolean;
  /** Why each earlier candidate was passed over, in order. */
  skipped: SkippedCandidate[];
}

/**
 * How long a provider+model sits out after refusing for a given reason.
 *
 * Quota gets a long window because subscription limits reset on the order of
 * hours, and retrying sooner just burns turns. An unknown model gets longer
 * still: that is a configuration error rather than a temporary condition, so
 * the cooldown exists to stop the router hammering it while the user fixes the
 * id. Transient and unknown failures get none — those are worth retrying.
 */
const COOLDOWN_MINUTES: Partial<Record<ProviderFailureKind, number>> = {
  quota_exhausted: 60,
  unknown_model: 180,
  unauthenticated: 15,
};

export function cooldownMinutesFor(kind: ProviderFailureKind): number | undefined {
  return COOLDOWN_MINUTES[kind];
}

const now = () => new Date().toISOString();

/**
 * Resolves which provider and model actually runs a role.
 *
 * The preference list belongs to the user; this walks it in order and reports
 * honestly. A candidate is passed over when it is disabled, unregistered,
 * unhealthy, or cooling down after a refusal — and every skip is recorded on
 * the route, because a substitution the user cannot see is worse than a failure
 * they can.
 */
export class RoleRouter {
  private readonly assignments: RoleAssignmentRepository;
  private readonly cooldowns: ProviderCooldownRepository;
  private readonly audit: AuditRepository;
  private readonly lastSkipped = new Map<RoutedRole, SkippedCandidate[]>();

  constructor(
    db: SqliteDb,
    private readonly registry: ProviderRegistry,
  ) {
    this.assignments = new RoleAssignmentRepository(db);
    this.cooldowns = new ProviderCooldownRepository(db);
    this.audit = new AuditRepository(db);
    this.seedDefaults();
  }

  /** Seeds shipping defaults once. Never overwrites the user's edits. */
  private seedDefaults(): void {
    if (this.assignments.hasAny()) return;
    const at = now();
    for (const role of ROUTED_ROLES) {
      this.assignments.replaceRole(role, DEFAULT_ROLE_ASSIGNMENTS[role], at);
    }
  }

  listRole(role: RoutedRole): RoleCandidate[] {
    return this.assignments.listForRole(role);
  }

  listAll(): Record<RoutedRole, RoleCandidate[]> {
    return Object.fromEntries(
      ROUTED_ROLES.map((role) => [role, this.assignments.listForRole(role)]),
    ) as Record<RoutedRole, RoleCandidate[]>;
  }

  replaceRole(role: RoutedRole, candidates: RoleCandidateInput[]): RoleCandidate[] {
    const saved = this.assignments.replaceRole(role, candidates, now());
    this.audit.append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'role.assignments.updated',
      targetType: 'role',
      targetId: role,
      details: {
        candidates: saved.map((candidate) => ({
          providerId: candidate.providerConnectionId,
          modelId: candidate.modelId,
          effort: candidate.effort,
          enabled: candidate.enabled,
        })),
      },
      createdAt: now(),
    });
    return saved;
  }

  /** Restores one role to its shipping default. */
  resetRole(role: RoutedRole): RoleCandidate[] {
    return this.replaceRole(role, DEFAULT_ROLE_ASSIGNMENTS[role]);
  }

  activeCooldowns() {
    return this.cooldowns.listActive(now());
  }

  clearCooldown(providerId: string, modelId: string): void {
    this.cooldowns.clear(providerId, modelId);
    this.audit.append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'provider.cooldown.cleared',
      targetType: 'provider',
      targetId: providerId,
      details: { modelId },
      createdAt: now(),
    });
  }

  /**
   * Parks a candidate after a refusal a retry cannot fix, and records why.
   *
   * Returns when it comes back, or `undefined` for failure kinds worth
   * retrying immediately.
   */
  recordFailure(
    role: RoutedRole,
    providerId: string,
    modelId: string,
    kind: ProviderFailureKind,
    detail?: string,
  ): string | undefined {
    const minutes = cooldownMinutesFor(kind);
    if (!minutes) return undefined;

    const startedAt = now();
    const until = new Date(Date.now() + minutes * 60_000).toISOString();
    this.cooldowns.start({
      providerConnectionId: providerId,
      modelId,
      reason: kind,
      detail: detail?.slice(0, 500),
      startedAt,
      until,
    });
    this.audit.append({
      id: randomUUID(),
      actor: 'system',
      action: 'provider.cooldown.started',
      targetType: 'provider',
      targetId: providerId,
      details: { role, modelId, reason: kind, until, detail: detail?.slice(0, 500) },
      createdAt: startedAt,
    });
    return until;
  }

  /**
   * Returns the provider that should run this turn, or `null` when nothing the
   * operator configured can serve it.
   *
   * `null` rather than a silent downgrade to the fake provider: fabricating
   * plausible output when a real model was asked for is the most misleading
   * outcome available, and it hides the one thing the operator needs to know.
   * The caller stops the run and surfaces the refusals instead.
   */
  async route(role: RoutedRole, options: { forceFake?: boolean } = {}): Promise<RoleRoute | null> {
    if (options.forceFake) return this.fakeRoute(role, []);

    const at = now();
    const skipped: SkippedCandidate[] = [];

    for (const candidate of this.assignments.listForRole(role)) {
      const { providerConnectionId: providerId, modelId } = candidate;

      if (!candidate.enabled) {
        skipped.push({ providerId, modelId, reason: 'disabled' });
        continue;
      }

      let adapter: ProviderAdapter;
      try {
        adapter = this.registry.get(providerId);
      } catch {
        skipped.push({
          providerId,
          modelId,
          reason: 'unknown_provider',
          detail: `Provider "${providerId}" is not registered`,
        });
        continue;
      }

      const cooldown = this.cooldowns
        .listActive(at)
        .find((item) => item.providerConnectionId === providerId && item.modelId === modelId);
      if (cooldown) {
        skipped.push({
          providerId,
          modelId,
          reason: 'cooling_down',
          detail: `${cooldown.reason} until ${cooldown.until}`,
        });
        continue;
      }

      const health = await this.registry.healthCheck(providerId);
      if (health.status !== 'ready') {
        skipped.push({
          providerId,
          modelId,
          reason: 'unhealthy',
          detail: health.detail ?? health.status,
        });
        continue;
      }

      return {
        role,
        providerId,
        providerDisplayName: await this.displayName(providerId),
        modelId,
        modelDisplayName: await this.modelDisplayName(providerId, modelId),
        effort: isEffort(candidate.effort) ? candidate.effort : undefined,
        adapter,
        fallbackUsed: skipped.length > 0,
        skipped,
      };
    }

    this.lastSkipped.set(role, skipped);
    return null;
  }

  /** Why each candidate was passed over on the most recent failed route. */
  skippedFor(role: RoutedRole): SkippedCandidate[] {
    return this.lastSkipped.get(role) ?? [];
  }

  private async displayName(providerId: string): Promise<string> {
    const listed = await this.registry.list({ includeFake: true }).catch(() => []);
    return listed.find((item) => item.id === providerId)?.displayName ?? providerId;
  }

  private async modelDisplayName(providerId: string, modelId: string): Promise<string> {
    const models = await this.registry.models(providerId).catch(() => []);
    return models.find((model) => model.id === modelId)?.displayName ?? modelId;
  }

  /**
   * Only reached through `forceFake`, which is an explicit offline/test mode.
   * It is deliberately not a fallback: see `route`.
   */
  private fakeRoute(role: RoutedRole, skipped: SkippedCandidate[]): RoleRoute {
    return {
      role,
      providerId: 'fake',
      providerDisplayName: 'Phase 0 Fake Provider',
      modelId: 'phase0-fake',
      modelDisplayName: 'Phase 0 Fake',
      adapter: this.registry.get('fake'),
      fallbackUsed: skipped.length > 0,
      skipped,
    };
  }
}
