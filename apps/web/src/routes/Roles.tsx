import { useState } from 'react';
import { Field } from '../components/Field.js';
import { Select, type SelectOption } from '../components/Select.js';
import { Shell } from '../components/Shell.js';
import { Empty, Section, StatusPill } from '../components/primitives.js';
import { api, useData } from '../lib/client.js';
import type { ProviderCatalogue, RoleCandidateView, RolesResponse } from '../types.js';

const EFFORT_HINTS: Record<string, string> = {
  none: 'No extra reasoning',
  low: 'Fast, lighter reasoning',
  medium: 'Balances speed and depth',
  high: 'Greater depth for complex work',
  xhigh: 'Extra depth',
  max: 'Consumes usage limits faster',
  ultra: 'Consumes usage limits fastest',
};

function relativeUntil(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000));
  if (minutes < 1) return 'any moment';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

export function Roles() {
  const { data, refetch, isLoading } = useData<RolesResponse>(['roles'], '/api/roles');
  const [draft, setDraft] = useState<Record<string, RoleCandidateView[]> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  if (isLoading || !data) {
    return (
      <Shell>
        <Empty message="Loading roles…" />
      </Shell>
    );
  }

  // The saved roster is the source of truth; a draft only exists for the role
  // being edited, so another tab's changes are not silently overwritten.
  const candidatesFor = (roleId: string): RoleCandidateView[] =>
    draft?.[roleId] ?? data.roles.find((role) => role.id === roleId)?.candidates ?? [];

  const edit = (roleId: string, next: RoleCandidateView[]) =>
    setDraft((current) => ({ ...(current ?? {}), [roleId]: next }));

  const providerOptions: SelectOption[] = data.providers.map((provider) => ({
    value: provider.providerId,
    label: provider.displayName,
    description:
      provider.status === 'ready'
        ? `${provider.models.length} model${provider.models.length === 1 ? '' : 's'} available`
        : `Not ready — ${provider.status}`,
  }));

  /**
   * The provider's catalogue, plus the configured id when it is not in it.
   *
   * A saved model can legitimately be absent: Codex forwards any id to the
   * account, and a catalogue can change under a saved choice. Dropping it would
   * leave the field looking empty while the daemon still routes to it — so it
   * is shown, and labelled as unrecognised.
   */
  const modelOptions = (providerId: string, current?: string): SelectOption[] => {
    const provider = data.providers.find((item) => item.providerId === providerId);
    const models = provider?.models ?? [];
    const options: SelectOption[] = models.map((model) => ({
      value: model.id,
      label: model.displayName,
      description: model.id,
    }));

    if (current && !models.some((model) => model.id === current)) {
      options.unshift({
        value: current,
        label: current,
        description: 'Not in this provider’s catalogue — it may be rejected',
      });
    }
    if (options.length === 0) {
      return [{ value: '', label: 'No models reported', description: 'Sign in, then refresh' }];
    }
    return options;
  };

  const effortOptions: SelectOption[] = [
    { value: '', label: 'Provider default', description: 'Let the CLI decide' },
    ...data.efforts.map((effort) => ({
      value: effort,
      label: effort,
      description: EFFORT_HINTS[effort] ?? '',
    })),
  ];

  const save = async (roleId: string) => {
    setBusy(roleId);
    setError('');
    setNote('');
    try {
      await api.request(`/api/roles/${roleId}`, {
        method: 'PUT',
        body: JSON.stringify({ candidates: candidatesFor(roleId) }),
      });
      setDraft((current) => {
        const next = { ...(current ?? {}) };
        delete next[roleId];
        return Object.keys(next).length ? next : null;
      });
      setNote(`Saved ${roleId}.`);
      void refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save role');
    } finally {
      setBusy(null);
    }
  };

  const reset = async (roleId: string) => {
    setBusy(roleId);
    setError('');
    try {
      await api.request(`/api/roles/${roleId}/reset`, { method: 'POST' });
      setDraft((current) => {
        const next = { ...(current ?? {}) };
        delete next[roleId];
        return Object.keys(next).length ? next : null;
      });
      setNote(`Restored the default for ${roleId}.`);
      void refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset role');
    } finally {
      setBusy(null);
    }
  };

  const clearCooldown = async (providerId: string, modelId: string) => {
    setError('');
    try {
      await api.request('/api/cooldowns/clear', {
        method: 'POST',
        body: JSON.stringify({ providerId, modelId }),
      });
      setNote(`${modelId} is available again.`);
      void refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear cooldown');
    }
  };

  const firstReadyProvider = (): ProviderCatalogue | undefined =>
    data.providers.find((provider) => provider.status === 'ready') ?? data.providers[0];

  return (
    <Shell>
      <Section title="Roles">
        <p className="lede">
          Each role runs down its list in order. RoleFlock uses the first candidate that is
          healthy and not out of quota, so put your preference on top and a fallback under it.
        </p>

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        {note ? (
          <p className="hint" role="status" aria-live="polite">
            {note}
          </p>
        ) : null}

        {data.cooldowns.length ? (
          <article className="pending-banner" role="region" aria-label="Paused providers">
            <p className="eyebrow">PAUSED</p>
            <h3>
              {data.cooldowns.length} model{data.cooldowns.length === 1 ? '' : 's'} temporarily
              unavailable
            </h3>
            <ul className="doc-list">
              {data.cooldowns.map((cooldown) => (
                <li key={`${cooldown.providerConnectionId}-${cooldown.modelId}`}>
                  <div>
                    <b>{cooldown.modelId}</b>
                    <small>
                      {cooldown.providerConnectionId} · {cooldown.reason.replaceAll('_', ' ')} ·
                      back in {relativeUntil(cooldown.until)}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() =>
                      void clearCooldown(cooldown.providerConnectionId, cooldown.modelId)
                    }
                  >
                    Try again now
                  </button>
                </li>
              ))}
            </ul>
          </article>
        ) : null}

        {data.roles.map((role) => {
          const candidates = candidatesFor(role.id);
          const dirty = Boolean(draft?.[role.id]);

          return (
            <article className="role-card" key={role.id}>
              <div className="role-head">
                <div>
                  <h3>{role.label}</h3>
                  <small>{role.description}</small>
                </div>
                <div className="actions compact-actions">
                  {/* Unsaved edits are the only state worth an accent button;
                      a permanently amber "Saved" reads as an action. */}
                  {dirty ? (
                    <button
                      type="button"
                      disabled={busy === role.id}
                      onClick={() => void save(role.id)}
                    >
                      {busy === role.id ? 'Saving…' : 'Save changes'}
                    </button>
                  ) : (
                    <StatusPill tone="muted">Saved</StatusPill>
                  )}
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy === role.id}
                    onClick={() => void reset(role.id)}
                  >
                    Reset
                  </button>
                </div>
              </div>

              <ol className="candidate-list">
                {candidates.map((candidate, index) => {
                  const move = (to: number) => {
                    const next = [...candidates];
                    const [moved] = next.splice(index, 1);
                    next.splice(to, 0, moved!);
                    edit(role.id, next);
                  };
                  const patch = (change: Partial<RoleCandidateView>) =>
                    edit(
                      role.id,
                      candidates.map((item, i) => (i === index ? { ...item, ...change } : item)),
                    );

                  return (
                    <li
                      className={candidate.enabled ? 'candidate' : 'candidate disabled'}
                      key={`${candidate.providerId}-${candidate.modelId}-${index}`}
                    >
                      <div className="candidate-rank">
                        <span aria-hidden="true">{index + 1}</span>
                        {index === 0 ? (
                          <StatusPill tone="ok">Preferred</StatusPill>
                        ) : (
                          <StatusPill tone="muted">Fallback</StatusPill>
                        )}
                      </div>

                      <div className="candidate-fields">
                        <Field label="Provider">
                          {({ id }) => (
                            <Select
                              id={id}
                              labelledBy={`${id}-label`}
                              value={candidate.providerId}
                              options={providerOptions}
                              onChange={(providerId) => {
                                // The old model id means nothing to a different
                                // provider, so adopt that provider's first model.
                                const models = modelOptions(providerId);
                                patch({ providerId, modelId: models[0]?.value ?? '' });
                              }}
                            />
                          )}
                        </Field>
                        <Field label="Model">
                          {({ id }) => (
                            <Select
                              id={id}
                              labelledBy={`${id}-label`}
                              value={candidate.modelId}
                              options={modelOptions(candidate.providerId, candidate.modelId)}
                              onChange={(modelId) => patch({ modelId })}
                              // Catalogues are not exhaustive: the Claude CLI
                              // publishes aliases but accepts a full model name,
                              // and Codex forwards any id to the account.
                              allowCustom
                              customHint="Custom id — sent to the CLI exactly as typed"
                            />
                          )}
                        </Field>
                        <Field label="Effort">
                          {({ id }) => (
                            <Select
                              id={id}
                              labelledBy={`${id}-label`}
                              value={candidate.effort ?? ''}
                              options={effortOptions}
                              onChange={(effort) => patch({ effort: effort || undefined })}
                            />
                          )}
                        </Field>
                      </div>

                      {candidate.coolingDownUntil ? (
                        <p className="hint">
                          Paused — back in {relativeUntil(candidate.coolingDownUntil)}.
                        </p>
                      ) : null}

                      <div className="actions compact-actions candidate-actions">
                        <button
                          type="button"
                          className="quiet"
                          disabled={index === 0}
                          aria-label={`Move ${candidate.modelId} up`}
                          onClick={() => move(index - 1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="quiet"
                          disabled={index === candidates.length - 1}
                          aria-label={`Move ${candidate.modelId} down`}
                          onClick={() => move(index + 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="quiet"
                          aria-pressed={!candidate.enabled}
                          onClick={() => patch({ enabled: !candidate.enabled })}
                        >
                          {candidate.enabled ? 'Skip' : 'Use'}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          disabled={candidates.length <= 1}
                          title={
                            candidates.length <= 1
                              ? 'A role needs at least one candidate'
                              : undefined
                          }
                          onClick={() =>
                            edit(
                              role.id,
                              candidates.filter((_, i) => i !== index),
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>

              <div className="actions">
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    const provider = firstReadyProvider();
                    edit(role.id, [
                      ...candidates,
                      {
                        providerId: provider?.providerId ?? 'fake',
                        modelId: provider?.models[0]?.id ?? 'phase0-fake',
                        enabled: true,
                      },
                    ]);
                  }}
                >
                  Add a fallback
                </button>
              </div>
            </article>
          );
        })}
      </Section>
    </Shell>
  );
}
