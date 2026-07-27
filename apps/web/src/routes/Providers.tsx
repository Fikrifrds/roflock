import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Field } from '../components/Field.js';
import { ProviderModels } from '../components/ProviderModels.js';
import { Select } from '../components/Select.js';
import { Shell } from '../components/Shell.js';
import { Empty, PageHeader, Section, StatusPill } from '../components/primitives.js';
import { api, useData } from '../lib/client.js';
import { formatTokenCount, providerStatusLabel, providerTone } from '../lib/format.js';
import type { DisclosureGrant, Project, Provider } from '../types.js';

export function Providers() {
  const queryClient = useQueryClient();
  const {
    data: providers = [],
    isLoading: providersLoading,
    isFetching: providersFetching,
  } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.request<Provider[]>('/api/providers'),
    refetchInterval: 15_000,
  });
  const { data: projects = [] } = useData<Project[]>(['projects'], '/api/projects');
  const { data: disclosureGrants = [], refetch: refetchDisclosure } = useData<DisclosureGrant[]>(
    ['disclosure-grants'],
    '/api/disclosure-grants',
  );

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [health, setHealth] = useState<Record<string, string>>({});
  const [authNote, setAuthNote] = useState<Record<string, string>>({});
  const [authBusy, setAuthBusy] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({ displayName: '', endpoint: '', apiKey: '', model: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [disclosureForm, setDisclosureForm] = useState({ projectId: '', providerConnectionId: '' });
  const [disclosureNote, setDisclosureNote] = useState('');
  const [disclosureBusy, setDisclosureBusy] = useState(false);

  async function onRegister(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await api.request('/api/providers', { method: 'POST', body: JSON.stringify(form) });
      setForm({ displayName: '', endpoint: '', apiKey: '', model: '' });
      await queryClient.invalidateQueries({ queryKey: ['providers'] });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to register provider');
    } finally {
      setSaving(false);
    }
  }

  async function runAuth(providerId: string, action: 'login' | 'logout' | 'switch') {
    setAuthBusy((current) => ({ ...current, [providerId]: true }));
    setAuthNote((current) => ({ ...current, [providerId]: `${action}…` }));
    try {
      const result = await api.request<{
        ok: boolean;
        detail: string;
        command?: string;
        launched?: boolean;
      }>(`/api/providers/${providerId}/auth/${action}`, { method: 'POST' });
      setAuthNote((current) => ({
        ...current,
        [providerId]: result.command
          ? `${result.detail}${result.launched ? '' : ` · run: ${result.command}`}`
          : result.detail,
      }));
      await queryClient.invalidateQueries({ queryKey: ['providers'] });
    } catch (error) {
      setAuthNote((current) => ({
        ...current,
        [providerId]: error instanceof Error ? error.message : `${action} failed`,
      }));
    } finally {
      setAuthBusy((current) => ({ ...current, [providerId]: false }));
    }
  }

  const visible = providers.filter((provider) => provider.id !== 'fake');

  return (
    <Shell>
      <PageHeader
        eyebrow="Model connections"
        title="Providers"
        description="Connect the local CLIs and model endpoints the flock can route to. Authentication remains owned by each provider."
      />
      <Section
        title="Available providers"
        description="Health, account state, capabilities, and local usage are checked independently."
      >
        {providersLoading ? (
          <Empty message="Loading providers…" />
        ) : visible.length ? (
          <>
            {providersFetching ? (
              <p className="hint" role="status" aria-live="polite">
                Updating providers…
              </p>
            ) : null}
            {visible.map((provider) => {
              const account = provider.account;
              const needsLogin = Boolean(account && !account.loggedIn && account.supportsLogin);
              const accountLabel = account?.loggedIn
                ? (account.email ?? account.label ?? 'Signed in')
                : needsLogin
                  ? 'Not signed in'
                  : (account?.label ?? null);
              return (
                <article className="provider-card" key={provider.id}>
                  <div className="row">
                    <div className="provider-meta">
                      <div className="provider-title">
                        <b>{provider.displayName}</b>
                        <StatusPill tone={providerTone(provider)}>
                          {providerStatusLabel(provider)}
                        </StatusPill>
                      </div>
                      {accountLabel ? <small>{accountLabel}</small> : null}
                      {account?.subscriptionType ? <small>{account.subscriptionType}</small> : null}
                      {account?.detail && !expanded[provider.id] ? (
                        <p className="hint truncate">{account.detail}</p>
                      ) : null}
                    </div>
                    <div className="actions compact-actions">
                      {needsLogin ? (
                        <button
                          type="button"
                          disabled={authBusy[provider.id]}
                          onClick={() => void runAuth(provider.id, 'login')}
                        >
                          {authBusy[provider.id] ? 'Opening…' : 'Sign in'}
                        </button>
                      ) : null}
                      {(account?.usageLinks ?? []).map((link) => (
                        <a
                          key={link.id}
                          className="quiet buttonish"
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          title={link.hint}
                        >
                          {link.label}
                        </a>
                      ))}
                      <button
                        type="button"
                        className="quiet"
                        aria-expanded={Boolean(expanded[provider.id])}
                        onClick={() =>
                          setExpanded((current) => ({
                            ...current,
                            [provider.id]: !current[provider.id],
                          }))
                        }
                      >
                        {expanded[provider.id] ? 'Hide details' : 'Details'}
                      </button>
                    </div>
                  </div>

                  {provider.localUsage ? (
                    <div className="provider-usage">
                      <p>
                        <span>Local tokens</span>
                        <b>
                          {formatTokenCount(
                            provider.localUsage.inputTokens + provider.localUsage.outputTokens,
                          )}
                        </b>{' '}
                        · {provider.localUsage.entryCount} calls
                      </p>
                      <small>
                        {formatTokenCount(provider.localUsage.inputTokens)} input ·{' '}
                        {formatTokenCount(provider.localUsage.outputTokens)} output
                      </small>
                      {expanded[provider.id] && provider.localUsage.models.length ? (
                        <ul
                          className="provider-model-usage"
                          aria-label={`${provider.displayName} token usage by model`}
                        >
                          {provider.localUsage.models.map((model) => (
                            <li key={model.modelId}>
                              <code>{model.modelId}</code>
                              <span>
                                {formatTokenCount(model.inputTokens + model.outputTokens)} tokens
                              </span>
                              <small>
                                {formatTokenCount(model.inputTokens)} in ·{' '}
                                {formatTokenCount(model.outputTokens)} out
                              </small>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  {authNote[provider.id] ? <p className="hint">{authNote[provider.id]}</p> : null}
                  {health[provider.id] ? (
                    <p className="hint">Health: {health[provider.id]}</p>
                  ) : null}

                  {expanded[provider.id] ? (
                    <div className="provider-details">
                      {account?.detail ? <p className="hint">{account.detail}</p> : null}
                      <div className="actions compact-actions">
                        {account?.loggedIn && account.supportsSwitch ? (
                          <button
                            type="button"
                            className="quiet"
                            disabled={authBusy[provider.id]}
                            onClick={() => void runAuth(provider.id, 'switch')}
                          >
                            Switch account
                          </button>
                        ) : null}
                        {account?.loggedIn && account.supportsLogin ? (
                          <button
                            type="button"
                            className="quiet"
                            disabled={authBusy[provider.id]}
                            onClick={() => void runAuth(provider.id, 'logout')}
                          >
                            Sign out
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="quiet"
                          onClick={async () => {
                            setHealth((current) => ({ ...current, [provider.id]: 'Checking…' }));
                            try {
                              const result = await api.request<{
                                healthy: boolean;
                                status: string;
                                detail?: string;
                              }>(`/api/providers/${provider.id}/health-check`, { method: 'POST' });
                              setHealth((current) => ({
                                ...current,
                                [provider.id]: result.detail
                                  ? `${result.status}: ${result.detail}`
                                  : result.status,
                              }));
                              await queryClient.invalidateQueries({ queryKey: ['providers'] });
                            } catch (error) {
                              setHealth((current) => ({
                                ...current,
                                [provider.id]:
                                  error instanceof Error ? error.message : 'Health check failed',
                              }));
                            }
                          }}
                        >
                          Check health
                        </button>
                      </div>
                      <div className="capabilities">
                        {Object.entries(provider.capabilities).map(([name, enabled]) => (
                          <span
                            key={name}
                            className={enabled ? 'capability enabled' : 'capability'}
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                      <ProviderModels providerId={provider.id} />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </>
        ) : (
          <Empty message="No providers found. Install Claude, Codex, or Cursor Agent CLI, then refresh." />
        )}
      </Section>

      <details className="advanced-panel">
        <summary>Add custom provider or disclosure allow-list</summary>

        <Section title="Add OpenAI-compatible provider">
          <p className="lede">
            Optional. Point RoleFlock at a local or remote OpenAI-compatible endpoint for reviewer.
          </p>
          <form className="stack" onSubmit={(event) => void onRegister(event)}>
            <Field label="Display name" htmlFor="provider-name">
              {({ id }) => (
                <input
                  id={id}
                  required
                  placeholder="Local OpenAI-compatible"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                />
              )}
            </Field>
            <Field label="Endpoint" htmlFor="provider-endpoint">
              {({ id }) => (
                <input
                  id={id}
                  required
                  placeholder="http://127.0.0.1:11434/v1"
                  value={form.endpoint}
                  onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                />
              )}
            </Field>
            <Field label="Model" htmlFor="provider-model">
              {({ id }) => (
                <input
                  id={id}
                  required
                  placeholder="gpt-4o-mini"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                />
              )}
            </Field>
            <Field
              label="API key"
              htmlFor="provider-key"
              optional
              hint="Stored locally and redacted from every export."
            >
              {({ id, describedBy }) => (
                <input
                  id={id}
                  aria-describedby={describedBy}
                  type="password"
                  placeholder="Not needed for most local endpoints"
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                />
              )}
            </Field>
            {formError ? (
              <p className="error" role="alert">
                {formError}
              </p>
            ) : null}
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Register provider'}
            </button>
          </form>
        </Section>

        <Section title="Allow provider access to briefs">
          <p className="lede">
            Let a provider receive task briefs and attached docs for one project.
          </p>
          <form
            className="stack"
            onSubmit={async (event: FormEvent) => {
              event.preventDefault();
              setDisclosureNote('');
              setDisclosureBusy(true);
              try {
                await api.request('/api/disclosure-grants', {
                  method: 'POST',
                  body: JSON.stringify({
                    projectId: disclosureForm.projectId,
                    providerConnectionId: disclosureForm.providerConnectionId,
                    scope: { taskBrief: true, documents: true },
                  }),
                });
                setDisclosureNote('Access allowed.');
                setDisclosureForm({ projectId: '', providerConnectionId: '' });
                void refetchDisclosure();
              } catch (error) {
                setDisclosureNote(
                  error instanceof Error ? error.message : 'Failed to create disclosure grant',
                );
              } finally {
                setDisclosureBusy(false);
              }
            }}
          >
            <Field label="Project" htmlFor="disclosure-project">
              {({ id }) => (
                <Select
                  id={id}
                  labelledBy={`${id}-label`}
                  required
                  placeholder="Choose a project"
                  value={disclosureForm.projectId}
                  options={projects.map((project) => ({
                    value: project.id,
                    label: project.name,
                    description: project.resolvedPath,
                  }))}
                  onChange={(projectId) => setDisclosureForm({ ...disclosureForm, projectId })}
                />
              )}
            </Field>
            <Field label="Provider" htmlFor="disclosure-provider">
              {({ id }) => (
                <Select
                  id={id}
                  labelledBy={`${id}-label`}
                  required
                  placeholder="Choose a provider"
                  value={disclosureForm.providerConnectionId}
                  options={visible.map((provider) => ({
                    value: provider.id,
                    label: provider.displayName,
                    description: providerStatusLabel(provider),
                  }))}
                  onChange={(providerConnectionId) =>
                    setDisclosureForm({ ...disclosureForm, providerConnectionId })
                  }
                />
              )}
            </Field>
            <button type="submit" disabled={disclosureBusy}>
              {disclosureBusy ? 'Saving…' : 'Allow briefs + docs'}
            </button>
            {disclosureNote ? (
              <p className="hint" role="status" aria-live="polite">
                {disclosureNote}
              </p>
            ) : null}
          </form>

          {disclosureGrants.filter((grant) => !grant.revokedAt).length ? (
            disclosureGrants
              .filter((grant) => !grant.revokedAt)
              .map((grant) => {
                const projectName =
                  projects.find((project) => project.id === grant.projectId)?.name ??
                  grant.projectId.slice(0, 8);
                const providerName =
                  visible.find((provider) => provider.id === grant.providerConnectionId)
                    ?.displayName ?? grant.providerConnectionId;
                return (
                  <article className="row" key={grant.id}>
                    <div>
                      <b>{providerName}</b>
                      <small>{projectName}</small>
                    </div>
                    <button
                      type="button"
                      className="quiet"
                      onClick={async () => {
                        await api.request(`/api/disclosure-grants/${grant.id}/revoke`, {
                          method: 'POST',
                        });
                        void refetchDisclosure();
                      }}
                    >
                      Revoke
                    </button>
                  </article>
                );
              })
          ) : (
            <Empty message="No allow-list entries yet." />
          )}
        </Section>
      </details>
    </Shell>
  );
}
