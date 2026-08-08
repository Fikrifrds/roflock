import { useState, type FormEvent } from 'react';
import { Field } from '../components/Field.js';
import { Select, type SelectOption } from '../components/Select.js';
import { Shell } from '../components/Shell.js';
import { Empty, PageHeader, Section } from '../components/primitives.js';
import { api, useData } from '../lib/client.js';
import { KNOWLEDGE_STATES, KNOWLEDGE_TYPES, withAnyOption } from '../lib/choices.js';
import type { KnowledgeItem, Project } from '../types.js';

export function Knowledge() {
  const { data: projects = [] } = useData<Project[]>(['projects'], '/api/projects');
  const [typeFilter, setTypeFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const query = [
    projectFilter ? `projectId=${encodeURIComponent(projectFilter)}` : '',
    typeFilter ? `type=${encodeURIComponent(typeFilter)}` : '',
    stateFilter ? `state=${encodeURIComponent(stateFilter)}` : '',
  ]
    .filter(Boolean)
    .join('&');
  const { data = [], refetch } = useData<KnowledgeItem[]>(
    ['knowledge', projectFilter, typeFilter, stateFilter],
    `/api/knowledge${query ? `?${query}` : ''}`,
  );
  const [form, setForm] = useState({
    projectId: '',
    type: 'coding_convention',
    title: '',
    body: '',
    state: 'candidate' as 'candidate' | 'published',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const projectOptions: SelectOption[] = [
    { value: '', label: 'Workspace-wide', description: 'Applies to every project' },
    ...projects.map((project) => ({
      value: project.id,
      label: project.name,
      description: project.resolvedPath,
    })),
  ];

  return (
    <Shell>
      <PageHeader
        eyebrow="Curated context"
        title="Knowledge"
        description="Manage the conventions and decisions Roflock may include in agent context. Candidate notes remain private until published."
      />
      <Section
        title="Add knowledge"
        description="Published entries can inform future planning and review."
        className="surface-section"
      >
        <form
          className="stack compact-form"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault();
            setError('');
            setSaving(true);
            try {
              await api.request('/api/knowledge', {
                method: 'POST',
                body: JSON.stringify({
                  projectId: form.projectId || undefined,
                  type: form.type,
                  title: form.title,
                  body: form.body,
                  state: form.state,
                }),
              });
              setForm((current) => ({ ...current, title: '', body: '' }));
              void refetch();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to save knowledge');
            } finally {
              setSaving(false);
            }
          }}
        >
          <Field label="Project" htmlFor="knowledge-project" optional>
            {({ id }) => (
              <Select
                id={id}
                labelledBy={`${id}-label`}
                value={form.projectId}
                options={projectOptions}
                onChange={(projectId) => setForm({ ...form, projectId })}
              />
            )}
          </Field>
          <div className="two-col">
            <Field label="Type" htmlFor="knowledge-type">
              {({ id }) => (
                <Select
                  id={id}
                  labelledBy={`${id}-label`}
                  value={form.type}
                  options={KNOWLEDGE_TYPES}
                  onChange={(type) => setForm({ ...form, type })}
                />
              )}
            </Field>
            <Field label="State" htmlFor="knowledge-state">
              {({ id }) => (
                <Select
                  id={id}
                  labelledBy={`${id}-label`}
                  value={form.state}
                  options={KNOWLEDGE_STATES}
                  onChange={(state) =>
                    setForm({ ...form, state: state as 'candidate' | 'published' })
                  }
                />
              )}
            </Field>
          </div>
          <Field label="Title" htmlFor="knowledge-title">
            {({ id }) => (
              <input
                id={id}
                required
                placeholder="Short, searchable summary"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            )}
          </Field>
          <Field label="Body" htmlFor="knowledge-body">
            {({ id }) => (
              <textarea
                id={id}
                className="compact"
                required
                placeholder="The rule, decision, or lesson — and why it holds"
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
            )}
          </Field>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Add knowledge'}
          </button>
        </form>
      </Section>

      <Section title="Library">
        <div className="two-col">
          <Field label="Project" htmlFor="filter-project">
            {({ id }) => (
              <Select
                id={id}
                labelledBy={`${id}-label`}
                value={projectFilter}
                options={withAnyOption(projectOptions.slice(1), 'All projects')}
                onChange={setProjectFilter}
              />
            )}
          </Field>
          <Field label="Type" htmlFor="filter-type">
            {({ id }) => (
              <Select
                id={id}
                labelledBy={`${id}-label`}
                value={typeFilter}
                options={withAnyOption(KNOWLEDGE_TYPES, 'All types')}
                onChange={setTypeFilter}
              />
            )}
          </Field>
          <Field label="State" htmlFor="filter-state">
            {({ id }) => (
              <Select
                id={id}
                labelledBy={`${id}-label`}
                value={stateFilter}
                options={withAnyOption(KNOWLEDGE_STATES, 'All states')}
                onChange={setStateFilter}
              />
            )}
          </Field>
        </div>
        {data.length ? (
          data.map((item) => (
            <article className="row" key={item.id}>
              <div>
                <b>{item.title}</b>
                <small>
                  {item.type} · {item.state}
                  {item.projectId ? ` · project ${item.projectId.slice(0, 8)}…` : ' · workspace'}
                </small>
                <small>
                  {item.body.slice(0, 240)}
                  {item.body.length > 240 ? '…' : ''}
                </small>
              </div>
              <em>{new Date(item.createdAt).toLocaleString()}</em>
            </article>
          ))
        ) : (
          <Empty message="No knowledge items match these filters." />
        )}
      </Section>
    </Shell>
  );
}
