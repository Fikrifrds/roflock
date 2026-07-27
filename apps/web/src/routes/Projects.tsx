import { useState, type FormEvent } from 'react';
import { Field } from '../components/Field.js';
import { Shell } from '../components/Shell.js';
import { Empty, PageHeader, Section } from '../components/primitives.js';
import { api, useData } from '../lib/client.js';
import type { Project } from '../types.js';

function suggestNameFromPath(repoPath: string): string {
  const parts = repoPath.replace(/\/+$/, '').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export function Projects() {
  const {
    data: projects = [],
    refetch,
    isLoading,
  } = useData<Project[]>(['projects'], '/api/projects');
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  return (
    <Shell>
      <PageHeader
        eyebrow="Repositories"
        title="Projects"
        description="Register local Git repositories. Every task runs on its own isolated branch and worktree."
      />
      <Section
        title="Add repository"
        description="RoleFlock resolves and validates the path before creating any task workspace."
        className="surface-section"
      >
        <form
          className="stack compact-form"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault();
            setError('');
            try {
              await api.request('/api/projects', {
                method: 'POST',
                body: JSON.stringify({ path, name: name.trim() || undefined }),
              });
              setPath('');
              setName('');
              setNameTouched(false);
              void refetch();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to register');
            }
          }}
        >
          <Field
            label="Local path"
            htmlFor="repo-path"
            hint="Tasks run in an isolated worktree, so your working copy is never touched."
          >
            {({ id, describedBy }) => (
              <div className="path-row">
                <input
                  id={id}
                  aria-describedby={describedBy}
                  placeholder="Select or paste a Git repository path"
                  value={path}
                  onChange={(e) => {
                    const next = e.target.value;
                    setPath(next);
                    if (!nameTouched) setName(suggestNameFromPath(next));
                  }}
                  required
                />
                <button
                  type="button"
                  className="quiet"
                  disabled={choosing}
                  onClick={async () => {
                    setError('');
                    setChoosing(true);
                    try {
                      const result = await api.request<{ path: string | null; cancelled: boolean }>(
                        '/api/dialogs/choose-directory',
                        { method: 'POST' },
                      );
                      if (!result.cancelled && result.path) {
                        setPath(result.path);
                        if (!nameTouched) setName(suggestNameFromPath(result.path));
                      }
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Folder picker failed');
                    } finally {
                      setChoosing(false);
                    }
                  }}
                >
                  {choosing ? 'Choosing…' : 'Choose folder'}
                </button>
              </div>
            )}
          </Field>

          <Field
            label="Display name"
            htmlFor="repo-name"
            optional
            hint="Defaults to the folder name."
          >
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                placeholder="e.g. Tilaqa Web"
                value={name}
                onChange={(e) => {
                  setNameTouched(true);
                  setName(e.target.value);
                }}
              />
            )}
          </Field>

          <button type="submit">Add project</button>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </Section>

      <Section
        title="Registered projects"
        description={`${projects.length} local repositor${projects.length === 1 ? 'y' : 'ies'} available to the flock`}
      >
        {isLoading ? <Empty message="Loading projects…" /> : null}
        {!isLoading && projects.length === 0 ? (
          <Empty message="No projects yet. Add a repository above to create tasks." />
        ) : null}
        {projects.map((project) => (
          <article className="row" key={project.id}>
            <div className="project-meta">
              {editingId === project.id ? (
                <form
                  className="rename-row"
                  onSubmit={async (event: FormEvent) => {
                    event.preventDefault();
                    try {
                      await api.request(`/api/projects/${project.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ name: editName }),
                      });
                      setEditingId(null);
                      void refetch();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Rename failed');
                    }
                  }}
                >
                  <label className="visually-hidden" htmlFor={`rename-${project.id}`}>
                    New name for {project.name}
                  </label>
                  <input
                    id={`rename-${project.id}`}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                    required
                  />
                  <button type="submit">Save</button>
                  <button type="button" className="quiet" onClick={() => setEditingId(null)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <b>{project.name}</b>
                  <small>{project.resolvedPath}</small>
                </>
              )}
            </div>
            <div className="row-actions">
              {editingId === project.id ? null : (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    setEditingId(project.id);
                    setEditName(project.name);
                  }}
                >
                  Rename
                </button>
              )}
              <em>{project.status}</em>
            </div>
          </article>
        ))}
      </Section>
    </Shell>
  );
}
