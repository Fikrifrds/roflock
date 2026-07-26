import { useState, type FormEvent } from 'react';
import { Shell } from '../components/Shell.js';
import { Empty, Section } from '../components/primitives.js';
import { api, useData } from '../lib/client.js';
import type { KnowledgeItem, Project } from '../types.js';

const KNOWLEDGE_TYPES = [
  ['architecture_decision', 'Architecture decision'],
  ['coding_convention', 'Coding convention'],
  ['past_failure', 'Past failure'],
  ['review_rule', 'Review rule'],
  ['test_pattern', 'Test pattern'],
  ['security_rule', 'Security rule'],
  ['rejected_approach', 'Rejected approach'],
] as const;

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

  return (
    <Shell>
      <Section title="Knowledge">
        <p className="lede">
          Notes that can be included in agent context when marked published. Drafts stay as
          candidates until you promote them.
        </p>
        <form
          className="stack"
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
          <label className="field-label" htmlFor="knowledge-project">
            Project (optional)
          </label>
          <select
            id="knowledge-project"
            value={form.projectId}
            onChange={(e) => setForm({ ...form, projectId: e.target.value })}
          >
            <option value="">Workspace-wide</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <div className="two-col">
            <div>
              <label className="field-label" htmlFor="knowledge-type">
                Type
              </label>
              <select
                id="knowledge-type"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {KNOWLEDGE_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="knowledge-state">
                State
              </label>
              <select
                id="knowledge-state"
                value={form.state}
                onChange={(e) =>
                  setForm({ ...form, state: e.target.value as 'candidate' | 'published' })
                }
              >
                <option value="candidate">Candidate</option>
                <option value="published">Published</option>
              </select>
            </div>
          </div>
          <label className="field-label" htmlFor="knowledge-title">
            Title
          </label>
          <input
            id="knowledge-title"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <label className="field-label" htmlFor="knowledge-body">
            Body
          </label>
          <textarea
            id="knowledge-body"
            className="compact"
            required
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
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
          <div>
            <label className="field-label" htmlFor="filter-project">
              Project
            </label>
            <select
              id="filter-project"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="filter-type">
              Type
            </label>
            <select
              id="filter-type"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="">All types</option>
              {KNOWLEDGE_TYPES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="filter-state">
              State
            </label>
            <select
              id="filter-state"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
            >
              <option value="">All states</option>
              <option value="candidate">Candidate</option>
              <option value="published">Published</option>
            </select>
          </div>
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
