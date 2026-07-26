import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell.js';
import { Empty, Section } from '../components/primitives.js';
import { api, useData } from '../lib/client.js';
import type { Approval } from '../types.js';

function grantMaximumRisk(risk: string): 'low' | 'medium' | 'high' {
  if (risk === 'critical') return 'high';
  return risk === 'low' || risk === 'medium' || risk === 'high' ? risk : 'medium';
}

export function Approvals() {
  const { data = [], refetch } = useData<Approval[]>(['approvals'], '/api/approvals');
  const [grantOffer, setGrantOffer] = useState<{ approval: Approval; projectId: string } | null>(
    null,
  );
  const [grantNote, setGrantNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const fingerprintCounts = data.reduce<Record<string, number>>((counts, approval) => {
    counts[approval.fingerprint] = (counts[approval.fingerprint] ?? 0) + 1;
    return counts;
  }, {});

  const approve = async (approval: Approval, alsoOfferGrant = true) => {
    setBusy(approval.id);
    setGrantNote('');
    try {
      await api.request(`/api/approvals/${approval.id}/approve`, { method: 'POST' });
      if (alsoOfferGrant && approval.taskId) {
        try {
          const task = await api.request<{ projectId: string }>(`/api/tasks/${approval.taskId}`);
          setGrantOffer({ approval, projectId: task.projectId });
        } catch {
          setGrantOffer(null);
        }
      }
      void refetch();
    } finally {
      setBusy(null);
    }
  };

  const createGrant = async () => {
    if (!grantOffer) return;
    setGrantNote('');
    try {
      await api.request('/api/approval-grants', {
        method: 'POST',
        body: JSON.stringify({
          projectId: grantOffer.projectId,
          scope: 'exact_fingerprint',
          fingerprint: grantOffer.approval.fingerprint,
          requestTypes: [grantOffer.approval.requestType],
          maximumRisk: grantMaximumRisk(grantOffer.approval.riskClass),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          maximumApplications: 25,
        }),
      });
      setGrantNote('Reuse grant saved for 24 hours.');
      setGrantOffer(null);
    } catch (error) {
      setGrantNote(error instanceof Error ? error.message : 'Failed to create grant');
    }
  };

  return (
    <Shell>
      <Section title="Approvals">
        <p className="lede">Decisions waiting before a task can continue.</p>
        {data.length ? (
          data.map((approval) => {
            const sameFingerprint = fingerprintCounts[approval.fingerprint] ?? 1;
            return (
              <article className="row" key={approval.id}>
                <div>
                  <b>{approval.requestType.replaceAll('_', ' ')}</b>
                  <small>{approval.rationale}</small>
                  <small>Risk: {approval.riskClass}</small>
                  {sameFingerprint > 1 ? (
                    <small>{sameFingerprint} similar requests pending</small>
                  ) : null}
                  {approval.taskId ? (
                    <Link to={`/tasks/${approval.taskId}`}>Open related task</Link>
                  ) : null}
                </div>
                <div className="actions">
                  <button
                    type="button"
                    disabled={busy === approval.id}
                    onClick={() => void approve(approval)}
                  >
                    {busy === approval.id ? 'Approving…' : 'Approve'}
                  </button>
                  {sameFingerprint > 1 ? (
                    <button
                      type="button"
                      className="quiet"
                      onClick={async () => {
                        setBusy(approval.id);
                        try {
                          await api.request(
                            `/api/approval-groups/${approval.id}/approve-all-once`,
                            {
                              method: 'POST',
                            },
                          );
                          void refetch();
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      Approve all once
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="quiet"
                    onClick={async () => {
                      await api.request(`/api/approvals/${approval.id}/reject`, { method: 'POST' });
                      void refetch();
                    }}
                  >
                    Reject
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <Empty message="Nothing waiting. When a reviewer needs you, it shows up here." />
        )}

        {grantOffer ? (
          <article className="pending-banner" role="region" aria-label="Remember this approval">
            <p className="eyebrow">OPTIONAL</p>
            <h3>Remember this approval for 24 hours?</h3>
            <p className="hint">Matching confirmations can continue without asking again.</p>
            <div className="actions">
              <button type="button" onClick={() => void createGrant()}>
                Remember for 24h
              </button>
              <button type="button" className="quiet" onClick={() => setGrantOffer(null)}>
                Not now
              </button>
            </div>
          </article>
        ) : null}
        {grantNote ? (
          <p className="hint" role="status" aria-live="polite">
            {grantNote}
          </p>
        ) : null}
      </Section>
    </Shell>
  );
}
