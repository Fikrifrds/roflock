import { useData } from '../lib/client.js';
import type { Tone } from '../lib/format.js';
import type { GraphRunView as GraphRunViewData } from '../types.js';
import { Empty, StatusPill } from './primitives.js';

const NODE_TONES: Record<string, Tone> = {
  completed: 'ok',
  running: 'info',
  failed: 'danger',
  skipped: 'muted',
  interrupted: 'warn',
  cancelled: 'warn',
  pending: 'muted',
};

const KIND_LABELS: Record<string, string> = {
  agent: 'Agent',
  model_call: 'Model call',
  command: 'Command',
  test: 'Deterministic check',
  router: 'Router',
  join: 'Join',
  human_approval: 'You decide',
  context_compile: 'Context',
  evidence_aggregate: 'Evidence',
};

const EDGE_LABELS: Record<string, string> = {
  on_fail: 'on failure',
  on_pass: 'on pass',
  on_needs_changes: 'needs changes',
  on_timeout: 'on timeout',
  on_provider_error: 'on provider error',
  on_budget_exhausted: 'on budget exhausted',
};

/**
 * Read-only projection of the run. It renders what the scheduler recorded and
 * schedules nothing itself, so it can never influence the graph it displays.
 */
export function GraphRunView({ taskId }: { taskId: string }) {
  const { data, isLoading } = useData<GraphRunViewData>(
    ['task-graph', taskId],
    `/api/tasks/${taskId}/graph`,
    Boolean(taskId),
  );

  if (isLoading) return <p className="hint">Loading run graph…</p>;
  if (!data) return <Empty message="No run graph available for this task." />;

  const { graph } = data;
  // Failure edges are the interesting ones: they are the routes a user cannot
  // infer from the happy-path node list alone.
  const failureEdges = graph.edges.filter((edge) => edge.when !== 'always');

  return (
    <div className="graph-run">
      <p className="hint">
        {graph.label} · <code>{graph.version}</code> · run {data.runState.replaceAll('_', ' ')} ·
        concurrency {graph.maxConcurrency} · loop budget {graph.maxLoopIterations}
      </p>
      <ol className="graph-nodes" aria-label="Workflow graph nodes">
        {graph.nodes.map((node) => (
          <li key={node.id} className={`graph-node ${node.state}`}>
            <div className="graph-node-head">
              <b>{node.id.replaceAll('_', ' ')}</b>
              <StatusPill tone={NODE_TONES[node.state] ?? 'muted'}>
                {node.state.replaceAll('_', ' ')}
              </StatusPill>
            </div>
            <small>
              {KIND_LABELS[node.kind] ?? node.kind}
              {node.writer ? ' · writer' : ''}
              {node.required ? ' · required gate' : ''}
              {node.maxAttempts > 1 ? ` · up to ${node.maxAttempts} attempts` : ''}
            </small>
            {node.attempts > 1 ? <small>{node.attempts} runs recorded</small> : null}
            {node.dependsOn.length ? <small>after {node.dependsOn.join(', ')}</small> : null}
          </li>
        ))}
      </ol>
      {failureEdges.length ? (
        <ul className="graph-edges" aria-label="Failure routes">
          {failureEdges.map((edge) => (
            <li key={`${edge.from}-${edge.to}-${edge.when}`}>
              {edge.from} → {edge.to} <em>{EDGE_LABELS[edge.when] ?? edge.when}</em>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
