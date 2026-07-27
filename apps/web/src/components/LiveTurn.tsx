import { Fragment, useEffect, useRef, type RefObject } from 'react';
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

type OutputBlock =
  | { type: 'text'; value: string }
  | { type: 'mermaid'; value: string };

function outputBlocks(output: string): OutputBlock[] {
  const blocks: OutputBlock[] = [];
  const fence = /```mermaid\s*\n([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of output.matchAll(fence)) {
    const at = match.index ?? 0;
    if (at > cursor) blocks.push({ type: 'text', value: output.slice(cursor, at) });
    blocks.push({ type: 'mermaid', value: (match[1] ?? '').trim() });
    cursor = at + match[0].length;
  }
  if (cursor < output.length) blocks.push({ type: 'text', value: output.slice(cursor) });
  return blocks.length ? blocks : [{ type: 'text', value: output }];
}

type DiagramStep = { from: string; to: string; label?: string };

function MermaidDiagram({ source }: { source: string }) {
  const steps: DiagramStep[] = [];
  for (const line of source.split('\n').map((item) => item.trim()).filter((item) => item.includes('-->'))) {
      const match = line.match(/^([\w*]+)(?:\[([^\]]+)\]|\{([^}]+)\}|\(([^)]+)\))?\s*-->(?:\|([^|]+)\|)?\s*([\w*]+)(?:\[([^\]]+)\]|\{([^}]+)\}|\(([^)]+)\))?(?::\s*(.*))?$/);
      if (!match) continue;
      const [, fromId, fromSquare, fromDiamond, fromRound, edgeLabel, toId, toSquare, toDiamond, toRound, stateLabel] = match;
      const from = fromSquare ?? fromDiamond ?? fromRound ?? fromId;
      const to = toSquare ?? toDiamond ?? toRound ?? toId;
      if (!from || !to) continue;
      steps.push({
        from,
        to,
        label: edgeLabel ?? stateLabel,
      });
  }

  return (
    <figure className="live-diagram">
      <figcaption>
        <span aria-hidden="true">◇</span> Diagram preview
      </figcaption>
      {steps.length ? (
        <ol className="live-diagram-flow">
          {steps.map((step, index) => (
            <li key={`${step.from}-${step.to}-${index}`}>
              <span className="diagram-node">{step.from}</span>
              <span className="diagram-arrow" aria-label={step.label ? `then: ${step.label}` : 'then'}>
                <i />
                {step.label ? <small>{step.label}</small> : null}
              </span>
              <span className="diagram-node">{step.to}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="hint">Diagram syntax is being streamed. The source is available below.</p>
      )}
      <details>
        <summary>View diagram source</summary>
        <pre>{source}</pre>
      </details>
    </figure>
  );
}

function HumanReadableText({ value }: { value: string }) {
  const lines = value.trim().split('\n');
  const isDocument = lines.some((line) => /^#{1,3}\s+/.test(line) || /^[-*]\s+/.test(line));
  if (!isDocument) return <pre className="output-pane">{value.trim()}</pre>;

  return (
    <div className="live-document">
      {lines.map((line, index) => {
        if (/^###\s+/.test(line)) return <h5 key={index}>{line.replace(/^###\s+/, '')}</h5>;
        if (/^##\s+/.test(line)) return <h4 key={index}>{line.replace(/^##\s+/, '')}</h4>;
        if (/^#\s+/.test(line)) return <h3 key={index}>{line.replace(/^#\s+/, '')}</h3>;
        if (/^[-*]\s+/.test(line)) return <p className="live-document-item" key={index}>{line.replace(/^[-*]\s+/, '')}</p>;
        if (!line.trim()) return <br key={index} />;
        return <p key={index}>{line}</p>;
      })}
    </div>
  );
}

function ReadableOutput({ output, outputRef }: { output: string; outputRef: RefObject<HTMLPreElement | null> }) {
  const blocks = outputBlocks(output);
  return (
    <div className="live-readable-output">
      {blocks.map((block, index) => (
        <Fragment key={index}>
          {block.type === 'mermaid' ? (
            <MermaidDiagram source={block.value} />
          ) : block.value.trim() ? (
            <HumanReadableText value={block.value} />
          ) : null}
        </Fragment>
      ))}
      <details className="live-raw-output">
        <summary>View raw output</summary>
        <pre ref={outputRef} className="output-pane" tabIndex={0}>{output}</pre>
      </details>
    </div>
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
  awaitingDecision = false,
  visible = true,
}: {
  execution: ActiveExecution | null | undefined;
  finished: boolean;
  awaitingDecision?: boolean;
  /** Active executions are retained for audit after a task stops. Do not show them as live. */
  visible?: boolean;
}) {
  const outputRef = useRef<HTMLPreElement>(null);
  const output = execution?.liveOutput ?? '';
  const diff = execution?.liveDiff;
  const activity = execution?.currentActivity?.trim();
  const provider = execution?.providerDisplayName ?? 'Provider sedang dipilih';
  const model = execution?.configuredModelDisplayName ?? 'Model sedang dipilih';

  useEffect(() => {
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [output]);

  if (!visible) return null;

  return (
    <section className="live-turn" aria-label="Live turn">
      <div className="live-turn-header">
        <div>
          <p className="eyebrow">Live turn</p>
          <h3>
            {awaitingDecision ? 'Your approval is required' : finished ? 'Turn complete' : 'Work in progress'}
          </h3>
        </div>
        <span
          className={`live-state ${awaitingDecision ? 'needs-decision' : finished ? 'done' : 'working'}`}
        >
          <span className="live-state-dot" aria-hidden="true" />
          {awaitingDecision ? 'Action required' : finished ? 'Complete' : 'Live'}
        </span>
      </div>

      <div className="live-context" aria-label="Active model">
        <span className="live-context-label">Provider</span>
        <strong>{provider}</strong>
        <span className="live-context-divider" aria-hidden="true">/</span>
        <span className="live-context-label">Model</span>
        <code>{model}</code>
        {execution?.effort ? <span className="live-effort">{execution.effort} effort</span> : null}
      </div>

      {!finished && !awaitingDecision ? (
        <div className="live-activity" role="status" aria-live="polite">
          <span className="live-spinner" aria-hidden="true" />
          <div>
            <strong>{activity || 'Thinking…'}</strong>
            <small>
              {output
                ? 'The model or command is still streaming output.'
                : 'Waiting for the first response from the model or command.'}
            </small>
          </div>
        </div>
      ) : null}

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
        <div className="live-output-head">
          <div>
            <span className="live-terminal-mark" aria-hidden="true">›_</span>
            <h4>{finished || awaitingDecision ? 'Final output' : 'Model & command output'}</h4>
          </div>
          {output ? <small>{output.split('\n').length.toLocaleString()} lines</small> : null}
        </div>
        {output ? (
          <ReadableOutput output={output} outputRef={outputRef} />
        ) : (
          <div className="live-output-empty">
            {!finished ? <span className="live-spinner" aria-hidden="true" /> : null}
            <span>
              {finished
                ? 'No output was captured for this turn.'
                : 'Thinking… waiting for the first token or command output.'}
            </span>
          </div>
        )}
      </article>
    </section>
  );
}
