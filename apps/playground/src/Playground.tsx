import { isExecutable, type Diagnostic, type GraphIR } from '@roleflock/graph-ir';
import { layoutGraph } from '@roleflock/graph-ui';
import { compile } from '@roleflock/language';
import { useMemo, useState } from 'react';
import { GraphDiagram } from './GraphDiagram.js';
import { DEFAULT_EXAMPLE, EXAMPLES } from './examples.js';
import { encodeShareLink } from './share.js';

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
    <main
      style={{
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        padding: 20,
        maxWidth: 1200,
        margin: '0 auto',
      }}
    >
      <header>
        <h1 style={{ fontSize: 22, margin: 0 }}>Roflock Playground</h1>
        <p style={{ color: '#475569', marginTop: 6 }}>
          Write a workflow, see the graph it compiles to. Everything runs in this tab — nothing is
          uploaded, and nothing here can run an agent.
        </p>
      </header>

      <section aria-label="Examples" style={{ margin: '14px 0' }}>
        {EXAMPLES.map((example) => (
          <button
            key={example.id}
            type="button"
            onClick={() => setSource(example.source)}
            title={example.summary}
            style={{ marginRight: 8, padding: '6px 10px' }}
          >
            {example.title}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(encodeShareLink(source, window.location.href.split('#')[0] ?? ''))
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
          style={{ padding: '6px 10px' }}
        >
          {copied ? 'Link copied' : 'Copy share link'}
        </button>
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <section aria-label="Source">
          <label htmlFor="source" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>
            Workflow source
          </label>
          <textarea
            id="source"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setCopied(false);
            }}
            spellCheck={false}
            rows={26}
            style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}
          />
        </section>

        <section aria-label="Result">
          <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>
            {errors.length > 0 ? 'Does not compile' : 'Compiles'}
          </h2>

          {/* Diagnostics first. A diagram drawn from stale IR beside a list of
              errors would suggest the errors are cosmetic. */}
          {result.diagnostics.length > 0 ? (
            <ul aria-label="Diagnostics" style={{ paddingLeft: 18, margin: '0 0 12px' }}>
              {result.diagnostics.map((diagnostic, index) => (
                <li
                  key={`${diagnostic.code}-${index}`}
                  style={{ color: diagnostic.severity === 'error' ? '#b91c1c' : '#b45309' }}
                >
                  <code>{diagnostic.code}</code>
                  {diagnostic.span ? ` line ${diagnostic.span.start.line}: ` : ': '}
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          ) : null}

          {layout ? (
            <>
              <p style={{ fontSize: 12, color: '#475569', margin: '0 0 8px' }}>
                {layout.nodes.length} nodes · {layout.edges.length} edges ·{' '}
                {layout.loops.length === 0
                  ? 'no repair loop'
                  : layout.loops
                      .map(
                        (loop) =>
                          `loop of ${loop.nodeIds.length} bounded at ${loop.maxAttempts} attempts`,
                      )
                      .join(', ')}
              </p>
              <GraphDiagram layout={layout} />
              <p style={{ fontSize: 11, color: '#64748b' }}>
                Solid lines are the path a successful run takes. Dashed lines are typed failure
                routes. A bold border marks the one node that may write.
              </p>
            </>
          ) : (
            <p style={{ color: '#64748b', fontSize: 13 }}>
              No graph yet — fix the errors above. Roflock never draws a partial graph, because half
              a workflow means something different from the whole one.
            </p>
          )}

          {isExecutable(result.diagnostics) && warnings.length > 0 ? (
            <p style={{ fontSize: 12, color: '#b45309' }}>
              This would run. The warnings above are worth reading anyway.
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
