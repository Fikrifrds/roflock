import { useEffect, useRef } from 'react';
import type { ActiveExecution } from '../types.js';
import { Empty } from './primitives.js';

function DiffStats({
  added,
  removed,
  files,
}: {
  added: number;
  removed: number;
  files: string[];
}) {
  return (
    <p className="live-diff-meta">
      <span className="diff-add">+{added}</span>
      <span className="diff-del">−{removed}</span>
      {files.length ? (
        <span className="hint">
          {files.length} file{files.length === 1 ? '' : 's'}: {files.slice(0, 8).join(', ')}
          {files.length > 8 ? ` +${files.length - 8} more` : ''}
        </span>
      ) : null}
    </p>
  );
}

/**
 * Streams the current turn's transcript and, for a writer, the live worktree
 * diff. Without this the task page only shows "still running" with no sense of
 * whether the model is thinking, writing, or stuck.
 */
export function LiveTurn({
  execution,
  finished,
}: {
  execution: ActiveExecution | null | undefined;
  finished: boolean;
}) {
  const outputRef = useRef<HTMLPreElement>(null);
  const output = execution?.liveOutput ?? '';
  const diff = execution?.liveDiff;

  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [output]);

  if (finished && !output && !diff?.patch) return null;

  return (
    <section className="live-turn" aria-label="Live turn">
      <div className="live-turn-header">
        <p className="eyebrow">Live turn</p>
        {!finished && execution?.currentActivity ? (
          <small className="hint">{execution.currentActivity}</small>
        ) : null}
      </div>

      {diff && (diff.patch || diff.changedFiles.length > 0) ? (
        <article className="live-diff">
          <h4>Worktree diff</h4>
          <DiffStats added={diff.added} removed={diff.removed} files={diff.changedFiles} />
          {diff.patch ? (
            <pre className="diff-pane" tabIndex={0}>
              {diff.patch}
            </pre>
          ) : (
            <Empty message="Waiting for the first file change…" />
          )}
        </article>
      ) : null}

      <article className="live-output">
        <h4>{finished ? 'Last output' : 'Model / command output'}</h4>
        {output ? (
          <pre ref={outputRef} className="output-pane" tabIndex={0}>
            {output}
          </pre>
        ) : (
          <Empty message={finished ? 'No output captured for this turn.' : 'Waiting for the first token…'} />
        )}
      </article>
    </section>
  );
}
