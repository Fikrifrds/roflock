import { useState, type FormEvent } from 'react';
import { Shell } from '../components/Shell.js';
import { Empty, Section } from '../components/primitives.js';
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
      <Section title="Projects">
        <p className="lede">
          Register a local Git repository. Tasks run inside an isolated worktree of that repo.
        </p>
        <form
          className="stack"
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
          <label className="field-label" htmlFor="repo-name">
            Display name
          </label>
          <input
            id="repo-name"
            placeholder="e.g. Tilaqa Web"
            value={name}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
          />
          <label className="field-label" htmlFor="repo-path">
            Local path
          </label>
          <div className="path-row">
            <input
              id="repo-path"
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
          <button type="submit">Add project</button>
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </form>

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
