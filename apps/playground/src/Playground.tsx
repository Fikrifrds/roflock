import { isExecutable, type Diagnostic, type GraphIR } from '@roleflock/graph-ir';
import { layoutGraph, toSvg } from '@roleflock/graph-ui';
import { compile } from '@roleflock/language';
import { useMemo, useRef, useState } from 'react';
import { DEFAULT_EXAMPLE, EXAMPLES } from './examples.js';
import { encodeShareLink } from './share.js';
import './styles.css';

/**
 * The public Playground.
 *
 * Everything runs in the browser: the same compiler, the same validator and the
 * same layout model the runtime and CLI use. That is the point — a diagram or a
 * diagnostic shown here is the one Roflock would act on, not an approximation
 * drawn by a second implementation.
 *
 * It reaches nothing. No daemon, no filesystem, no shell, no credentials. The
 * PRD forbids a public origin reaching local execution, and an app with no server
 * to call is the simplest way to guarantee it.
 */

export interface PlaygroundProps {
  initialSource?: string;
}

interface CompileState {
  ir?: GraphIR;
  diagnostics: Diagnostic[];
}

export function Playground({ initialSource = DEFAULT_EXAMPLE.source }: PlaygroundProps) {
  const [source, setSource] = useState(initialSource);
  const [copied, setCopied] = useState(false);
  const [importNotice, setImportNotice] = useState<string | undefined>();
  const fileInput = useRef<HTMLInputElement>(null);

  const result = useMemo<CompileState>(() => {
    const compiled = compile(source, { uri: 'playground.roflock' });
    return {
      ...(compiled.ir === undefined ? {} : { ir: compiled.ir }),
      diagnostics: compiled.diagnostics,
    };
  }, [source]);

  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  const warnings = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');
  const layout = useMemo(() => (result.ir ? layoutGraph(result.ir) : undefined), [result.ir]);

  return (
    <main className="playground-shell">
      <header className="playground-header">
        <div className="playground-brand">
          <span className="playground-mark" aria-hidden="true">
            RO
          </span>
          <span>
            <strong>ROFLOCK</strong>
            <small>AI coding teams as code</small>
          </span>
        </div>
        <div className="playground-safety" aria-label="Playground safety">
          <span className="safety-dot" />
          <span>Browser-only</span>
          <span className="safety-divider" aria-hidden="true" />
          <span>No daemon access</span>
        </div>
      </header>

      <section className="playground-hero">
        <div>
          <p className="playground-eyebrow">Language playground</p>
          <h1>Shape the workflow before it runs.</h1>
          <p className="playground-lede">
            Write a <code>.roflock</code> workflow and see the exact graph it compiles to. Nothing
            is uploaded, and nothing here can run an agent.
          </p>
        </div>
        <div className="playground-hero-note">
          <span className="hero-note-number">01</span>
          <span>Source → Graph IR → Validation</span>
        </div>
      </section>

      <section className="playground-tutorial" aria-label="How the Playground works">
        <div>
          <p className="panel-kicker">A short path to confidence</p>
          <h2>Three things to check before a workflow runs.</h2>
        </div>
        <ol>
          <li>
            <strong>01 · intent</strong>
            <span>Read the roles and objectives in source; they are the public contract.</span>
          </li>
          <li>
            <strong>02 · control</strong>
            <span>Follow graph edges, bounded repair loops, checks, and human gates.</span>
          </li>
          <li>
            <strong>03 · identity</strong>
            <span>Use the compiled Graph IR and semantic hash when reviewing a change.</span>
          </li>
        </ol>
      </section>

      <section className="example-toolbar" aria-label="Examples">
        <div className="toolbar-label">
          <span className="toolbar-kicker">Start from a pattern</span>
          <span>Change the source anytime</span>
        </div>
        {EXAMPLES.map((example) => (
          <button
            key={example.id}
            type="button"
            className="example-button"
            onClick={() => setSource(example.source)}
            title={example.summary}
            aria-pressed={source === example.source}
          >
            {example.title}
          </button>
        ))}
        <input
          ref={fileInput}
          className="visually-hidden"
          type="file"
          accept=".roflock,text/plain"
          aria-label="Import Roflock workflow"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            void file
              .text()
              .then((text) => {
                setSource(text);
                setCopied(false);
                setImportNotice(`Loaded ${file.name} locally.`);
              })
              .catch(() => setImportNotice(`Could not read ${file.name}.`));
            event.target.value = '';
          }}
        />
        <button type="button" className="toolbar-button" onClick={() => fileInput.current?.click()}>
          Import .roflock
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([source], { type: 'text/plain;charset=utf-8' }),
            );
            const link = document.createElement('a');
            link.href = url;
            link.download = 'workflow.roflock';
            link.click();
            URL.revokeObjectURL(url);
          }}
        >
          Download source
        </button>
        <button
          type="button"
          className="share-button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(encodeShareLink(source, window.location.href.split('#')[0] ?? ''))
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          <span aria-hidden="true">↗</span> {copied ? 'Link copied' : 'Copy share link'}
        </button>
      </section>
      {importNotice ? <p className="import-notice">{importNotice}</p> : null}

      <div className="playground-grid">
        <section className="playground-panel editor-panel" aria-label="Source">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Authoring surface</span>
              <h2>Workflow source</h2>
            </div>
            <code>playground.roflock</code>
          </div>
          <textarea
            id="source"
            aria-label="Workflow source"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setCopied(false);
            }}
            spellCheck={false}
            rows={26}
          />
          <div className="editor-footer">
            <span>Edits compile as you type</span>
            <span className="editor-status">
              <span className="status-dot" />
              Local only
            </span>
          </div>
        </section>

        <section className="playground-panel result-panel" aria-label="Result">
          <div className="panel-heading">
            <div>
              <span className="panel-kicker">Canonical output</span>
              <h2>Compiled graph</h2>
            </div>
            <span className={`compile-status ${errors.length > 0 ? 'invalid' : 'valid'}`}>
              <span className="status-dot" />
              {errors.length > 0 ? 'Does not compile' : 'Compiles'}
            </span>
          </div>

          {/* Diagnostics first. A diagram drawn from stale IR beside a list of
              errors would suggest the errors are cosmetic. */}
          {result.diagnostics.length > 0 ? (
            <ul className="diagnostics" aria-label="Diagnostics">
              {result.diagnostics.map((diagnostic, index) => (
                <li
                  key={`${diagnostic.code}-${index}`}
                  className={
                    diagnostic.severity === 'error' ? 'diagnostic-error' : 'diagnostic-warning'
                  }
                >
                  <span className="diagnostic-code">
                    <code>{diagnostic.code}</code>
                  </span>
                  <span>
                    {diagnostic.span ? `line ${diagnostic.span.start.line}: ` : ''}
                    {diagnostic.message}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {layout ? (
            <>
              <div className="graph-meta">
                {layout.nodes.length} nodes · {layout.edges.length} edges ·{' '}
                {layout.loops.length === 0
                  ? 'no repair loop'
                  : layout.loops
                      .map(
                        (loop) =>
                          `loop of ${loop.nodeIds.length} bounded at ${loop.maxAttempts} attempts`,
                      )
                      .join(', ')}
              </div>
              {/* Drawn by graph-ui, the same renderer Studio and `roflock
                  render` use — a second implementation here would be the
                  divergence that package exists to prevent. The markup comes
                  from our own renderer over compiled IR, and every label it
                  embeds is escaped. */}
              <div className="diagram-frame">
                <div
                  aria-label="Workflow diagram"
                  dangerouslySetInnerHTML={{ __html: toSvg(layout) }}
                />
              </div>
              <p className="diagram-caption">
                Solid lines are the path a successful run takes. Dashed lines are typed failure
                routes. A bold border marks the one node that may write.
              </p>
              <details className="ir-details">
                <summary>Inspect canonical Graph IR</summary>
                <p>
                  This normalized document is what the runtime bridge receives. It is generated
                  locally from the source above.
                </p>
                <pre>{JSON.stringify(result.ir, null, 2)}</pre>
              </details>
            </>
          ) : (
            <p className="empty-graph">
              No graph yet — fix the errors above. Roflock never draws a partial graph, because half
              a workflow means something different from the whole one.
            </p>
          )}

          {isExecutable(result.diagnostics) && warnings.length > 0 ? (
            <p className="compile-note">
              This would run. The warnings above are worth reading anyway.
            </p>
          ) : null}
        </section>
      </div>
      <footer className="playground-footer">
        <span>
          <strong>Roflock</strong> compiles the same source used by the runtime and CLI.
        </span>
        <span>Share links stay in the URL fragment — never sent to a server.</span>
      </footer>
    </main>
  );
}
