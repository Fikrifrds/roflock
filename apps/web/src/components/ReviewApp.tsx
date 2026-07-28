import { useState } from 'react';
import { api, useData } from '../lib/client.js';

type ReviewAppState = {
  available: boolean;
  mode?: 'static' | 'run';
  state?: 'ready' | 'starting' | 'running' | 'stopped' | 'failed';
  url?: string;
  command?: string;
  detail?: string;
};

export function ReviewApp({ taskId }: { taskId: string }) {
  const { data, refetch } = useData<ReviewAppState>(
    ['review-app', taskId],
    `/api/tasks/${taskId}/review-app`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!data?.available) return null;
  const running = data.state === 'running' || data.state === 'starting';
  const open = async () => {
    setBusy(true);
    setError('');
    try {
      const preview = await api.request<ReviewAppState>(`/api/tasks/${taskId}/review-app/start`, {
        method: 'POST',
      });
      if (preview.state === 'failed') {
        setError(preview.detail || 'Preview failed to start');
      } else if (preview.url) {
        window.open(preview.url, '_blank', 'noopener,noreferrer');
      }
      await refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start review app');
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    setBusy(true);
    setError('');
    try {
      await api.request(`/api/tasks/${taskId}/review-app/stop`, { method: 'POST' });
      await refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to stop review app');
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="review-app" aria-label="Review app">
      <div>
        <p className="eyebrow">REVIEW APP</p>
        <strong>{data.mode === 'static' ? 'Static result ready' : 'Local app preview'}</strong>
        <p>{data.detail}</p>
        {data.command ? <code>{data.command}</code> : null}
        {error ? <p className="error">{error}</p> : null}
      </div>
      <div className="actions">
        {running && data.url ? (
          <a className="buttonish" href={data.url} target="_blank" rel="noreferrer">
            Open app
          </a>
        ) : (
          <button type="button" onClick={() => void open()} disabled={busy}>
            {busy ? 'Starting…' : data.mode === 'static' ? 'Open app' : 'Run & open app'}
          </button>
        )}
        {running ? (
          <button type="button" className="quiet" onClick={() => void stop()} disabled={busy}>
            Stop preview
          </button>
        ) : null}
      </div>
    </aside>
  );
}
