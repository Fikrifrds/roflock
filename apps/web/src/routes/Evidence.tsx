import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { EvidenceSection } from '../components/EvidenceSection.js';
import { Shell } from '../components/Shell.js';
import { Empty, Section } from '../components/primitives.js';
import { api, useData } from '../lib/client.js';
import { downloadJson, formatValue, parseJsonField } from '../lib/format.js';
import type { EvidenceBundle, Task, Usage } from '../types.js';

export function Evidence() {
  const { id = '' } = useParams();
  const { data } = useData<EvidenceBundle>(
    ['evidence', id],
    `/api/evidence/tasks/${id}`,
    Boolean(id),
  );
  const { data: usage } = useData<Usage>(['usage', id], `/api/usage/tasks/${id}`, Boolean(id));
  const { data: task } = useData<Task>(['task', id], `/api/tasks/${id}`, Boolean(id));
  const [exportNote, setExportNote] = useState('');

  const exportJson = async (path: string, filename: string) => {
    setExportNote('');
    try {
      downloadJson(await api.request<unknown>(path), filename);
      setExportNote(`Downloaded ${filename}`);
    } catch (error) {
      setExportNote(error instanceof Error ? error.message : 'Export failed');
    }
  };

  const disclosures = data?.disclosures ?? [];
  const tests = data?.testRuns ?? [];
  const passedTests = tests.filter((row) => {
    const value = (row as { passed?: unknown }).passed;
    return value === true || value === 1;
  }).length;
  const failedTests = tests.filter((row) => {
    const value = (row as { passed?: unknown }).passed;
    return value === false || value === 0;
  }).length;
  const warnings = (data?.findings ?? []).filter((row) => {
    const severity = String((row as { severity?: unknown }).severity ?? '').toLowerCase();
    return severity === 'warning' || severity === 'error';
  }).length;
  const latestArtefact = [...(data?.artefacts ?? [])]
    .reverse()
    .find((row) => (row as { kind?: unknown }).kind === 'diff') as
    { metadata_json?: string } | undefined;
  const latestMeta = parseJsonField(latestArtefact?.metadata_json);
  const latestMetaObject =
    latestMeta && !Array.isArray(latestMeta) ? (latestMeta as Record<string, unknown>) : {};
  const changedFiles = Array.isArray(latestMetaObject.changedFiles)
    ? latestMetaObject.changedFiles.length
    : 0;
  const added = typeof latestMetaObject.added === 'number' ? latestMetaObject.added : 0;
  const removed = typeof latestMetaObject.removed === 'number' ? latestMetaObject.removed : 0;

  return (
    <Shell>
      <Section title="Evidence ledger">
        <div className="status-strip" aria-label="Verification summary">
          <div>
            <span>Task outcome</span>
            <b>{task?.state?.replaceAll('_', ' ') ?? 'Loading…'}</b>
          </div>
          <div>
            <span>Repository change</span>
            <b>
              {changedFiles} file{changedFiles === 1 ? '' : 's'} · +{added}/−{removed}
            </b>
          </div>
          <div>
            <span>Verification</span>
            <b>
              {passedTests} passed · {failedTests} failed
            </b>
          </div>
          <div>
            <span>Warnings / errors</span>
            <b>{warnings}</b>
          </div>
          <div>
            <span>Recorded cost</span>
            <b>${(usage?.summary?.actualCostUsd ?? 0).toFixed(4)}</b>
          </div>
        </div>
        <div className="actions">
          <button
            type="button"
            className="quiet"
            onClick={() =>
              void exportJson(`/api/tasks/${id}/export/evidence`, `roleflock-evidence-${id}.json`)
            }
          >
            Export evidence bundle
          </button>
          <button
            type="button"
            className="quiet"
            onClick={() =>
              void exportJson(`/api/tasks/${id}/export/audit`, `roleflock-audit-${id}.json`)
            }
          >
            Export audit pack
          </button>
        </div>
        {exportNote ? (
          <p className="hint" role="status" aria-live="polite">
            {exportNote}
          </p>
        ) : null}

        <EvidenceSection title="Findings" items={data?.findings ?? []} />
        <EvidenceSection title="Test runs" items={data?.testRuns ?? []} />

        <section className="evidence-section">
          <h3>Artefacts / diff</h3>
          {data?.artefacts?.length ? (
            data.artefacts.map((row, index) => {
              const artefact = row as {
                id?: string;
                kind?: string;
                path?: string;
                content_ref?: string;
                metadata_json?: string;
                created_at?: string;
              };
              const meta = parseJsonField(artefact.metadata_json);
              const metaObj = meta && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
              const files = Array.isArray(metaObj.changedFiles)
                ? (metaObj.changedFiles as string[])
                : [];
              const added = typeof metaObj.added === 'number' ? metaObj.added : undefined;
              const removed = typeof metaObj.removed === 'number' ? metaObj.removed : undefined;
              return (
                <article className="evidence-item" key={String(artefact.id ?? index)}>
                  <p>
                    <span>kind</span> {artefact.kind ?? '—'}
                  </p>
                  <p>
                    <span>path</span> {artefact.path ?? '—'}
                  </p>
                  {files.length || added !== undefined ? (
                    <p className="live-diff-meta">
                      {added !== undefined ? <span className="diff-add">+{added}</span> : null}
                      {removed !== undefined ? <span className="diff-del">−{removed}</span> : null}
                      {files.length ? <span className="hint">{files.join(', ')}</span> : null}
                    </p>
                  ) : null}
                  {artefact.content_ref ? (
                    <pre className="diff-pane" tabIndex={0}>
                      {artefact.content_ref}
                    </pre>
                  ) : null}
                  <p>
                    <span>created</span> {artefact.created_at ?? '—'}
                  </p>
                </article>
              );
            })
          ) : (
            <Empty message="No artefacts / diff recorded yet." />
          )}
        </section>

        <section className="evidence-section">
          <h3>Usage</h3>
          {usage?.summary ? (
            <article className="evidence-item">
              <p>
                <span>scope</span> {usage.scope ?? 'local-daemon'}
              </p>
              <p>
                <span>actual cost</span> ${(usage.summary.actualCostUsd ?? 0).toFixed(4)}
              </p>
              <p>
                <span>shadow cost</span> ${(usage.summary.shadowCostUsd ?? 0).toFixed(4)} (not a
                bill)
              </p>
              {usage.summary.budget ? (
                <p>
                  <span>budget</span>{' '}
                  {usage.summary.budget.maxActualCostUsd === undefined
                    ? 'uncapped'
                    : `$${usage.summary.budget.remainingUsd?.toFixed(4) ?? '0'} remaining${
                        usage.summary.budget.warning ? ' · warning' : ''
                      }${usage.summary.budget.hardStop ? ' · hard stop' : ''}`}
                </p>
              ) : null}
              {usage.note ? <p className="hint">{usage.note}</p> : null}
            </article>
          ) : (
            <Empty message="No usage recorded yet." />
          )}
          <EvidenceSection title="Ledger entries" items={usage?.entries ?? []} />
        </section>

        <EvidenceSection title="Disclosures" items={disclosures} />

        <section className="evidence-section">
          <h3>Context inspector</h3>
          {disclosures.length ? (
            disclosures.map((row, index) => {
              const selectedRaw = parseJsonField(
                (row as { selected_context_json?: string }).selected_context_json,
              );
              const selected =
                selectedRaw && !Array.isArray(selectedRaw)
                  ? (selectedRaw as Record<string, unknown>)
                  : {};
              const exclusions = parseJsonField(
                (row as { exclusions_json?: string }).exclusions_json,
              );
              const entries = Array.isArray(selected.entries)
                ? (selected.entries as Array<{ source?: string; tokens?: number }>)
                : [];
              const omitted = Array.isArray(selected.omitted)
                ? (selected.omitted as Array<{ id?: string; reason?: string }>)
                : [];
              return (
                <article
                  className="evidence-item"
                  key={String((row as { id?: string }).id ?? index)}
                >
                  <p>
                    <span>role</span> {String(selected.role ?? '—')}
                  </p>
                  <p>
                    <span>tokens</span> {String(selected.totalTokens ?? '—')} · <span>bytes</span>{' '}
                    {String(selected.totalBytes ?? '—')}
                  </p>
                  <p>
                    <span>sources</span>{' '}
                    {entries.length
                      ? entries
                          .map((entry) => `${entry.source ?? '?'} (${entry.tokens ?? 0} tok)`)
                          .join(' · ')
                      : '—'}
                  </p>
                  <p>
                    <span>omitted</span>{' '}
                    {omitted.length
                      ? omitted.map((item) => `${item.id}: ${item.reason}`).join(' · ')
                      : 'none'}
                  </p>
                  <p>
                    <span>exclusions</span>{' '}
                    {Array.isArray(exclusions) ? exclusions.join(', ') : formatValue(exclusions)}
                  </p>
                </article>
              );
            })
          ) : (
            <Empty message="No disclosure manifests yet. Start a task to compile context." />
          )}
        </section>

        <details className="raw-json">
          <summary>Raw JSON</summary>
          <pre>{JSON.stringify({ evidence: data, usage }, null, 2)}</pre>
        </details>
      </Section>
    </Shell>
  );
}
