import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase, ProviderCooldownRepository } from '@roleflock/database';
import {
  FakeProvider,
  classifyProviderFailure,
  refusalInOutput,
} from '@roleflock/provider-core';
import { ProviderRegistry } from '../src/services/provider-registry.js';
import { RoleRouter, cooldownMinutesFor } from '../src/services/role-routing.js';
import { DEFAULT_ROLE_ASSIGNMENTS } from '../src/services/role-defaults.js';

async function harness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'rf-roles-'));
  const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
  const registry = new ProviderRegistry();
  return { router: new RoleRouter(db, registry), db, registry };
}

describe('role defaults', () => {
  it('gives every role an ordered list ending in the deterministic provider', () => {
    for (const [role, candidates] of Object.entries(DEFAULT_ROLE_ASSIGNMENTS)) {
      expect(candidates.length, `${role} needs a fallback`).toBeGreaterThan(1);
      expect(candidates.at(-1)?.providerConnectionId, `${role} must end in fake`).toBe('fake');
    }
  });

  it('routes the requested models by default', () => {
    // The operator's stated preferences. A silent change here would send work
    // to a different model than they asked for.
    expect(DEFAULT_ROLE_ASSIGNMENTS.planner[0]).toMatchObject({
      providerConnectionId: 'cursor',
      modelId: 'claude-opus-5-high',
    });
    expect(DEFAULT_ROLE_ASSIGNMENTS.planner[1]?.modelId).toBe('gpt-5.6-sol-high');
    expect(DEFAULT_ROLE_ASSIGNMENTS.writer[0]?.modelId).toBe('cursor-grok-4.5-high');
    expect(DEFAULT_ROLE_ASSIGNMENTS.reviewer[0]?.modelId).toBe('gpt-5.6-terra-medium');
    expect(DEFAULT_ROLE_ASSIGNMENTS.reviewer[1]?.modelId).toBe('claude-opus-5-low');
  });

  it('reaches the same model through a second provider where one exists', () => {
    // Cursor and Codex meter separately, so an exhausted Cursor plan should
    // cost the run a provider rather than the model.
    expect(
      DEFAULT_ROLE_ASSIGNMENTS.planner.some(
        (c) => c.providerConnectionId === 'codex' && c.modelId === 'gpt-5.6-sol',
      ),
    ).toBe(true);
    expect(
      DEFAULT_ROLE_ASSIGNMENTS.reviewer.some(
        (c) => c.providerConnectionId === 'codex' && c.modelId === 'gpt-5.6-terra',
      ),
    ).toBe(true);
  });
});

describe('RoleRouter', () => {
  let h: Awaited<ReturnType<typeof harness>>;

  beforeEach(async () => {
    h = await harness();
  });

  it('seeds defaults on first use and never overwrites edits', () => {
    expect(h.router.listRole('planner')[0]?.modelId).toBe('claude-opus-5-high');

    h.router.replaceRole('planner', [{ providerConnectionId: 'fake', modelId: 'phase0-fake' }]);

    const restarted = new RoleRouter(h.db, h.registry);
    expect(restarted.listRole('planner')).toHaveLength(1);
    expect(restarted.listRole('planner')[0]?.modelId).toBe('phase0-fake');
  });

  it('forceFake selects the fake provider without consulting the list', async () => {
    const route = await h.router.route('planner', { forceFake: true });
    expect(route.providerId).toBe('fake');
    expect(route.adapter).toBeInstanceOf(FakeProvider);
    expect(route.fallbackUsed).toBe(false);
  });

  it('routes to the first healthy candidate and reports what it passed over', async () => {
    h.router.replaceRole('planner', [
      { providerConnectionId: 'nonexistent', modelId: 'ghost' },
      { providerConnectionId: 'fake', modelId: 'phase0-fake' },
    ]);

    const route = await h.router.route('planner');
    expect(route.providerId).toBe('fake');
    expect(route.fallbackUsed).toBe(true);
    expect(route.skipped).toEqual([
      expect.objectContaining({ providerId: 'nonexistent', reason: 'unknown_provider' }),
    ]);
  });

  it('skips a disabled candidate without treating it as a failure', async () => {
    h.router.replaceRole('reviewer', [
      { providerConnectionId: 'fake', modelId: 'switched-off', enabled: false },
      { providerConnectionId: 'fake', modelId: 'phase0-fake' },
    ]);

    const route = await h.router.route('reviewer');
    expect(route.modelId).toBe('phase0-fake');
    expect(route.skipped[0]).toMatchObject({ reason: 'disabled' });
  });

  it('carries the configured effort onto the route', async () => {
    h.router.replaceRole('writer', [
      { providerConnectionId: 'fake', modelId: 'phase0-fake', effort: 'xhigh' },
    ]);
    expect((await h.router.route('writer')).effort).toBe('xhigh');
  });

  it('parks a quota-exhausted candidate and moves to the next one', async () => {
    h.router.replaceRole('planner', [
      { providerConnectionId: 'fake', modelId: 'expensive' },
      { providerConnectionId: 'fake', modelId: 'phase0-fake' },
    ]);
    expect((await h.router.route('planner')).modelId).toBe('expensive');

    const until = h.router.recordFailure(
      'planner',
      'fake',
      'expensive',
      'quota_exhausted',
      'rate limit reached for this model',
    );
    expect(until).toBeTruthy();

    const after = await h.router.route('planner');
    expect(after.modelId).toBe('phase0-fake');
    expect(after.fallbackUsed).toBe(true);
    expect(after.skipped[0]).toMatchObject({ reason: 'cooling_down' });
  });

  it('does not park a candidate for a failure worth retrying', () => {
    expect(h.router.recordFailure('planner', 'fake', 'x', 'transient')).toBeUndefined();
    expect(h.router.recordFailure('planner', 'fake', 'x', 'unknown')).toBeUndefined();
    expect(h.router.activeCooldowns()).toHaveLength(0);
  });

  it('lets the operator lift a cooldown by hand', async () => {
    h.router.replaceRole('planner', [
      { providerConnectionId: 'fake', modelId: 'paused' },
      { providerConnectionId: 'fake', modelId: 'phase0-fake' },
    ]);
    h.router.recordFailure('planner', 'fake', 'paused', 'quota_exhausted');
    expect((await h.router.route('planner')).modelId).toBe('phase0-fake');

    h.router.clearCooldown('fake', 'paused');
    expect((await h.router.route('planner')).modelId).toBe('paused');
  });

  it('never shortens a cooldown that is already running', () => {
    const cooldowns = new ProviderCooldownRepository(h.db);
    const far = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
    cooldowns.start({
      providerConnectionId: 'fake',
      modelId: 'm',
      reason: 'quota_exhausted',
      startedAt: new Date().toISOString(),
      until: far,
    });
    // A second, shorter refusal must not bring the model back early.
    h.router.recordFailure('planner', 'fake', 'm', 'unauthenticated');
    expect(cooldowns.listActive(new Date().toISOString())[0]?.until).toBe(far);
  });

  it('survives a restart with its cooldowns intact', async () => {
    h.router.replaceRole('planner', [
      { providerConnectionId: 'fake', modelId: 'spent' },
      { providerConnectionId: 'fake', modelId: 'phase0-fake' },
    ]);
    h.router.recordFailure('planner', 'fake', 'spent', 'quota_exhausted');

    // Restarting must not re-run into a wall the provider already described.
    const restarted = new RoleRouter(h.db, h.registry);
    expect((await restarted.route('planner')).modelId).toBe('phase0-fake');
  });

  it('falls back to the deterministic provider when everything is skipped', async () => {
    h.router.replaceRole('verifier', [
      { providerConnectionId: 'ghost-a', modelId: 'a' },
      { providerConnectionId: 'ghost-b', modelId: 'b' },
    ]);
    const route = await h.router.route('verifier');
    expect(route.providerId).toBe('fake');
    // Degrading silently would be the most misleading outcome available.
    expect(route.fallbackUsed).toBe(true);
    expect(route.skipped).toHaveLength(2);
  });

  it('resets a role to its shipping default', () => {
    h.router.replaceRole('writer', [{ providerConnectionId: 'fake', modelId: 'phase0-fake' }]);
    expect(h.router.resetRole('writer')[0]?.modelId).toBe('cursor-grok-4.5-high');
  });
});

describe('provider failure classification', () => {
  it('recognises a spent quota across vendor phrasings', () => {
    for (const message of [
      'Error: 429 Too Many Requests',
      'You have exceeded your usage limit for this model',
      'rate_limit_error: please try again later',
      'Your credit balance is too low to run this request',
      'insufficient_quota',
    ]) {
      expect(classifyProviderFailure(message), message).toBe('quota_exhausted');
    }
  });

  it('separates a bad model id from a dead session', () => {
    expect(classifyProviderFailure('Unknown model: gpt-9')).toBe('unknown_model');
    expect(classifyProviderFailure('Not logged in. Run: agent login')).toBe('unauthenticated');
  });

  it('reads quota first when a message could be either', () => {
    // Vendors return 403 for a spent plan. Calling that an auth problem would
    // send the user to re-login instead of on to another provider.
    expect(classifyProviderFailure('403 Forbidden: usage limit reached')).toBe('quota_exhausted');
  });

  it('leaves an unrecognised message retryable', () => {
    expect(classifyProviderFailure('something went sideways')).toBe('unknown');
    expect(classifyProviderFailure('')).toBe('unknown');
    expect(classifyProviderFailure(undefined)).toBe('unknown');
  });

  it('only parks the failures a retry cannot fix', () => {
    expect(cooldownMinutesFor('quota_exhausted')).toBeGreaterThan(0);
    expect(cooldownMinutesFor('unknown_model')).toBeGreaterThan(0);
    expect(cooldownMinutesFor('transient')).toBeUndefined();
    expect(cooldownMinutesFor('unknown')).toBeUndefined();
  });
});

describe('refusals that exit successfully', () => {
  it('catches a CLI that refuses a model while reporting success', () => {
    // Cursor Agent's exact wording, on stderr, with exit code 0. Trusting the
    // exit code would turn a model typo into a run that produced nothing and
    // said it worked — and the graph would carry on from there.
    const stderr = 'Cannot use this model: bogus-x. Available models: auto, gpt-5.3-codex-low';
    expect(refusalInOutput(stderr)).toBe('unknown_model');
  });

  it('catches a spent quota on a zero exit too', () => {
    expect(refusalInOutput('You have hit your usage limit for today')).toBe('quota_exhausted');
    expect(refusalInOutput('Not logged in. Run: agent login')).toBe('unauthenticated');
  });

  it('leaves ordinary chatter alone', () => {
    // Warnings and progress noise must not be read as a refusal, or every run
    // would fail over for nothing.
    expect(refusalInOutput('warning: node 24 is experimental')).toBeUndefined();
    expect(refusalInOutput('   ')).toBeUndefined();
    expect(refusalInOutput(undefined)).toBeUndefined();
  });
});
