import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase, ProviderCooldownRepository } from '@roleflock/database';
import {
  FakeProvider,
  classifyProviderFailure,
  parseReportedUsage,
  refusalInOutput,
} from '@roleflock/provider-core';
import { ProviderRegistry } from '../src/services/provider-registry.js';
import { RoleRouter, cooldownMinutesFor } from '../src/services/role-routing.js';
import { DEFAULT_ROLE_ASSIGNMENTS } from '../src/services/role-defaults.js';
import { ProviderUnavailableError } from '../src/services/orchestrator.js';

async function harness() {
  const dataDir = await mkdtemp(join(tmpdir(), 'rf-roles-'));
  const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
  const registry = new ProviderRegistry();
  return { router: new RoleRouter(db, registry), db, registry };
}

describe('role defaults', () => {
  it('gives every role a fallback, and never the fake provider', () => {
    for (const [role, candidates] of Object.entries(DEFAULT_ROLE_ASSIGNMENTS)) {
      expect(candidates.length, `${role} needs a fallback`).toBeGreaterThan(1);
      // Falling through to the fake provider would fabricate plausible output
      // when a real model was asked for, hiding the one thing the operator
      // needs to act on. The run must stop instead.
      expect(
        candidates.some((c) => c.providerConnectionId === 'fake'),
        `${role} must not silently degrade to fake`,
      ).toBe(false);
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
    expect(route?.providerId).toBe('fake');
    expect(route?.adapter).toBeInstanceOf(FakeProvider);
    expect(route?.fallbackUsed).toBe(false);
  });

  it('routes to the first healthy candidate and reports what it passed over', async () => {
    h.router.replaceRole('planner', [
      { providerConnectionId: 'nonexistent', modelId: 'ghost' },
      { providerConnectionId: 'fake', modelId: 'phase0-fake' },
    ]);

    const route = await h.router.route('planner');
    expect(route?.providerId).toBe('fake');
    expect(route?.fallbackUsed).toBe(true);
    expect(route?.skipped).toEqual([
      expect.objectContaining({ providerId: 'nonexistent', reason: 'unknown_provider' }),
    ]);
  });

  it('skips a disabled candidate without treating it as a failure', async () => {
    h.router.replaceRole('reviewer', [
      { providerConnectionId: 'fake', modelId: 'switched-off', enabled: false },
      { providerConnectionId: 'fake', modelId: 'phase0-fake' },
    ]);

    const route = await h.router.route('reviewer');
    expect(route?.modelId).toBe('phase0-fake');
    expect(route?.skipped[0]).toMatchObject({ reason: 'disabled' });
  });

  it('carries the configured effort onto the route', async () => {
    h.router.replaceRole('writer', [
      { providerConnectionId: 'fake', modelId: 'phase0-fake', effort: 'xhigh' },
    ]);
    expect((await h.router.route('writer'))?.effort).toBe('xhigh');
  });

  it('parks a quota-exhausted candidate and moves to the next one', async () => {
    h.router.replaceRole('planner', [
      { providerConnectionId: 'fake', modelId: 'expensive' },
      { providerConnectionId: 'fake', modelId: 'phase0-fake' },
    ]);
    expect((await h.router.route('planner'))?.modelId).toBe('expensive');

    const until = h.router.recordFailure(
      'planner',
      'fake',
      'expensive',
      'quota_exhausted',
      'rate limit reached for this model',
    );
    expect(until).toBeTruthy();

    const after = await h.router.route('planner');
    expect(after?.modelId).toBe('phase0-fake');
    expect(after?.fallbackUsed).toBe(true);
    expect(after?.skipped[0]).toMatchObject({ reason: 'cooling_down' });
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
    expect((await h.router.route('planner'))?.modelId).toBe('phase0-fake');

    h.router.clearCooldown('fake', 'paused');
    expect((await h.router.route('planner'))?.modelId).toBe('paused');
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
    expect((await restarted.route('planner'))?.modelId).toBe('phase0-fake');
  });

  it('returns nothing when every candidate is skipped, rather than inventing one', async () => {
    h.router.replaceRole('verifier', [
      { providerConnectionId: 'ghost-a', modelId: 'a' },
      { providerConnectionId: 'ghost-b', modelId: 'b' },
    ]);
    // The caller stops the run on null. Quietly substituting the fake provider
    // here would produce plausible output for a model that never ran.
    expect(await h.router.route('verifier')).toBeNull();
    expect(h.router.skippedFor('verifier')).toHaveLength(2);
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

describe('ProviderUnavailableError', () => {
  it('names the role and every provider that refused', () => {
    const error = new ProviderUnavailableError('planner', [
      {
        providerId: 'cursor',
        providerDisplayName: 'Cursor Agent CLI',
        modelId: 'claude-opus-5-high',
        modelDisplayName: 'Opus 5 1M',
        reason: 'quota_exhausted',
        detail: 'usage limit reached',
        until: new Date().toISOString(),
      },
      {
        providerId: 'codex',
        providerDisplayName: 'Codex CLI',
        modelId: 'gpt-5.6-sol',
        modelDisplayName: 'GPT-5.6 Sol',
        reason: 'unknown_model',
        detail: 'unknown model',
        until: new Date().toISOString(),
      },
    ]);

    // The operator has to act on this, so the message must say what to fix
    // rather than only that something went wrong.
    expect(error.message).toContain('planner');
    expect(error.message).toContain('Cursor Agent CLI/Opus 5 1M (quota exhausted)');
    expect(error.message).toContain('Codex CLI/GPT-5.6 Sol (unknown model)');
    expect(error.role).toBe('planner');
    expect(error.refusals).toHaveLength(2);
  });

  it('reads sensibly when nothing was even reachable', () => {
    expect(new ProviderUnavailableError('writer', []).message).toContain(
      'no candidate was reachable',
    );
  });
});

describe('reported usage', () => {
  it('reads the token counts each CLI actually sends', () => {
    // Cursor's spelling.
    expect(
      parseReportedUsage({ inputTokens: 7930, outputTokens: 14, cacheReadTokens: 5248 }),
    ).toMatchObject({ inputTokens: 7930, outputTokens: 14, cacheReadTokens: 5248 });

    // Codex's spelling.
    expect(
      parseReportedUsage({ input_tokens: 14748, cached_input_tokens: 11008, output_tokens: 5 }),
    ).toMatchObject({ inputTokens: 14748, cacheReadTokens: 11008, outputTokens: 5 });

    // Claude Code additionally prices the turn, which beats any local estimate.
    expect(
      parseReportedUsage({ input_tokens: 2, output_tokens: 4, total_cost_usd: 0.0752 }),
    ).toMatchObject({ inputTokens: 2, outputTokens: 4, totalCostUsd: 0.0752 });
  });

  it('keeps "not reported" distinguishable from zero', () => {
    // A fabricated token count would make the cost ledger fiction, so absence
    // has to survive as absence rather than collapsing to 0.
    expect(parseReportedUsage(undefined)).toBeUndefined();
    expect(parseReportedUsage({})).toBeUndefined();
    expect(parseReportedUsage({ inputTokens: 'lots' })).toBeUndefined();
    expect(parseReportedUsage({ inputTokens: 0 })).toMatchObject({ inputTokens: 0 });
  });
});
