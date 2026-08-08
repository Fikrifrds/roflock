import { useData } from '../lib/client.js';

/**
 * The workflow a task is executing: its `.roflock` source beside the graph that
 * source compiles to.
 *
 * Both come from the daemon rather than being reconstructed here. The source is
 * the file on disk, and the diagram is the shared layout the CLI and Playground
 * draw — so Studio cannot show a workflow that differs from the one that runs.
 *
 * A task pinned to a hard-coded template has no source to show, and this says so
 * instead of drawing something plausible.
 */

interface DiagramResponse {
  graphVersionId: string;
  source: string | null;
  semanticHash: string | null;
  svg: string;
  layout: {
    nodes: Array<{ id: string }>;
    edges: Array<{ kind: string }>;
    loops: Array<{ nodeIds: string[]; maxAttempts: number }>;
  };
}

export function WorkflowSource({ taskId }: { taskId: string }) {
  const { data, isLoading, error } = useData<DiagramResponse>(
    ['task-diagram', taskId],
    `/api/tasks/${taskId}/diagram`,
  );

  if (isLoading) return <p>Loading the workflow…</p>;

  if (error || !data) {
    return (
      <section aria-label="Workflow">
        <h2>Workflow</h2>
        <p>
          This task runs a built-in template compiled before workflows moved to
          <code> .roflock</code> source, so there is no source to show. The run graph above is still
          the graph it is executing.
        </p>
      </section>
    );
  }

  const loops = data.layout.loops;

  return (
    <section aria-label="Workflow">
      <h2>Workflow</h2>
      <p>
        <code>{data.graphVersionId}</code>
        {data.semanticHash ? <> · {data.semanticHash.slice(0, 19)}…</> : null}
        {' · '}
        {data.layout.nodes.length} nodes
        {' · '}
        {loops.length === 0
          ? 'no repair loop'
          : loops
              .map((loop) => `repair loop of ${loop.nodeIds.length} bounded at ${loop.maxAttempts}`)
              .join(', ')}
      </p>

      <div>
        <h3>Diagram</h3>
        {/* Rendered by graph-ui, the same drawing `roflock render` produces. The
            markup is generated from Graph IR by our own code, not from user
            input, and the renderer escapes every label it embeds. */}
        <div aria-label="Workflow diagram" dangerouslySetInnerHTML={{ __html: data.svg }} />
      </div>

      {data.source === null ? null : (
        <div>
          <h3>Source</h3>
          <pre>
            <code>{data.source}</code>
          </pre>
        </div>
      )}
    </section>
  );
}
