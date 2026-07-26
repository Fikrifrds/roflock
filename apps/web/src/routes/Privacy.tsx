import { useState } from 'react';
import { Shell } from '../components/Shell.js';
import { Section } from '../components/primitives.js';
import { api, useData } from '../lib/client.js';
import { downloadJson } from '../lib/format.js';

export function Privacy() {
  const { data: privacy } = useData<{ localOnly: boolean; claims: string[] }>(
    ['privacy'],
    '/api/privacy',
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setNote('');
    try {
      setNote(await work());
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <Section title="Privacy & local data">
        <p className="lede">
          Everything stays on this machine. Use backup/export when you need a copy; delete wipes
          RoleFlock data only (not your git repos).
        </p>
        <ul className="claim-list">
          {(privacy?.claims ?? []).map((claim) => (
            <li key={claim}>{claim}</li>
          ))}
        </ul>
        <div className="actions">
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await api.request<{ backupDir: string }>('/api/data/backup', {
                  method: 'POST',
                });
                return `Backup written to ${result.backupDir}`;
              })
            }
          >
            Backup local database
          </button>
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                downloadJson(
                  await api.request<unknown>('/api/diagnostics/export'),
                  'roleflock-diagnostics.json',
                );
                return 'Downloaded redacted diagnostics';
              })
            }
          >
            Export diagnostics
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(
                  'Delete all local RoleFlock data (database, documents, worktrees)? Repository folders on disk are kept.',
                )
              ) {
                return;
              }
              void run(async () => {
                const result = await api.request<{ note?: string }>('/api/data/delete', {
                  method: 'POST',
                  body: JSON.stringify({ confirm: 'DELETE_LOCAL_DATA' }),
                });
                return result.note ?? 'Local data deleted. Restart the daemon.';
              });
            }}
          >
            Delete local data
          </button>
        </div>
        {note ? (
          <p className="hint" role="status" aria-live="polite">
            {note}
          </p>
        ) : null}
      </Section>
    </Shell>
  );
}
