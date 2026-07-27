import { useData } from '../lib/client.js';
import type { Tone } from '../lib/format.js';
import type { ActiveExecution, GraphRunView as GraphRunViewData } from '../types.js';
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

const KIND_MARKS: Record<string, string> = {
  agent: 'AI',
  model_call: 'AI',
  command: '›_',
  test: '✓',
  router: '◇',
  join: '＋',
  human_approval: 'YOU',
  context_compile: 'CTX',
  evidence_aggregate: 'EV',
};

const NODE_WIDTH = 210;
const NODE_MIN_HEIGHT = 148;
const COLUMN_GAP = 76;
const ROW_GAP = 48;
const CANVAS_PADDING_X = 36;
const CANVAS_PADDING_Y = 40;

type GraphNode = GraphRunViewData['graph']['nodes'][number];
type GraphEdge = GraphRunViewData['graph']['edges'][number];
type NodePosition = { x: number; y: number; depth: number; height: number };

function nodeDescriptor(node: GraphNode) {
  return [
    node.role === 'reviewer' ? 'AI review · You approve' : (KIND_LABELS[node.kind] ?? node.kind),
    node.writer ? 'writer' : '',
    node.required ? 'required gate' : '',
    node.maxAttempts > 1 ? `up to ${node.maxAttempts} attempts` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function wrappedLineCount(value: string, charactersPerLine = 27) {
  return Math.max(1, Math.ceil(value.length / charactersPerLine));
}

function nodeHeight(node: GraphNode) {
  let height = NODE_MIN_HEIGHT;
  height += Math.max(0, wrappedLineCount(nodeDescriptor(node)) - 1) * 17;
  if (node.focus) height += 16 + wrappedLineCount(node.focus, 29) * 16;
  if (node.primaryProviderDisplayName && node.primaryModelDisplayName) {
    height += 24 + Math.max(0, wrappedLineCount(node.primaryModelDisplayName, 24) - 1) * 15;
  }
  if (node.role !== node.id) height += 20;
  if (node.attempts > 1) height += 18;
  if (node.dependsOn.length) {
    height += wrappedLineCount(`after ${node.dependsOn.join(', ')}`) * 17;
  }
  return height;
}

function nodeMark(node: GraphNode, index: number) {
  if (node.role === 'reviewer') return 'AI · YOU';
  return KIND_MARKS[node.kind] ?? String(index + 1).padStart(2, '0');
}

function layoutGraph(nodes: GraphNode[], failureEdgeCount: number) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const depths = new Map<string, number>();

  const depthOf = (node: GraphNode, visiting = new Set<string>()): number => {
    const cached = depths.get(node.id);
    if (cached !== undefined) return cached;
    if (visiting.has(node.id)) return 0;
    visiting.add(node.id);
    const depth = node.dependsOn.length
      ? Math.max(
          0,
          ...node.dependsOn.map((id) => {
            const dependency = byId.get(id);
            return dependency ? depthOf(dependency, visiting) + 1 : 0;
          }),
        )
      : 0;
    visiting.delete(node.id);
    depths.set(node.id, depth);
    return depth;
  };

  for (const node of nodes) depthOf(node);

  const columns = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const depth = depths.get(node.id) ?? 0;
    columns.set(depth, [...(columns.get(depth) ?? []), node]);
  }

  const columnHeights = new Map(
    [...columns].map(([depth, column]) => [
      depth,
      column.reduce((total, node) => total + nodeHeight(node), 0) +
        Math.max(0, column.length - 1) * ROW_GAP,
    ]),
  );
  const nodeAreaHeight = Math.max(NODE_MIN_HEIGHT, ...columnHeights.values());
  const positions = new Map<string, NodePosition>();

  for (const [depth, column] of columns) {
    const columnHeight = columnHeights.get(depth) ?? NODE_MIN_HEIGHT;
    const offsetY = CANVAS_PADDING_Y + (nodeAreaHeight - columnHeight) / 2;
    let nextY = offsetY;
    column.forEach((node) => {
      const height = nodeHeight(node);
      positions.set(node.id, {
        x: CANVAS_PADDING_X + depth * (NODE_WIDTH + COLUMN_GAP),
        y: nextY,
        depth,
        height,
      });
      nextY += height + ROW_GAP;
    });
  }

  const maxDepth = Math.max(0, ...depths.values());
  const returnLaneHeight = failureEdgeCount ? 54 + (failureEdgeCount - 1) * 28 : 0;
  return {
    positions,
    width: CANVAS_PADDING_X * 2 + (maxDepth + 1) * NODE_WIDTH + maxDepth * COLUMN_GAP,
    height: CANVAS_PADDING_Y * 2 + nodeAreaHeight + returnLaneHeight,
    returnLaneStart: CANVAS_PADDING_Y + nodeAreaHeight + 34,
  };
}

function forwardPath(from: NodePosition, to: NodePosition) {
  const startX = from.x + NODE_WIDTH;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  const bend = Math.max(34, (endX - startX) * 0.46);
  return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}

function returnPath(from: NodePosition, to: NodePosition, laneY: number) {
  const startX = from.x + NODE_WIDTH / 2;
  const startY = from.y + from.height;
  const endX = to.x + NODE_WIDTH / 2;
  const endY = to.y + to.height;
  return `M ${startX} ${startY} C ${startX} ${laneY}, ${endX} ${laneY}, ${endX} ${endY}`;
}

function edgeState(edge: GraphEdge, nodes: Map<string, GraphNode>) {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (edge.when !== 'always') {
    return from?.state === 'failed' || from?.state === 'interrupted' ? 'triggered' : 'exception';
  }
  if (to?.state === 'running') return 'active';
  if (from?.state === 'completed' && to?.state === 'completed') return 'complete';
  return 'idle';
}

/**
 * Read-only projection of the run. It renders what the scheduler recorded and
 * schedules nothing itself, so it can never influence the graph it displays.
 */
export function GraphRunView({
  taskId,
  execution,
}: {
  taskId: string;
  execution?: ActiveExecution | null;
}) {
  const { data, isLoading } = useData<GraphRunViewData>(
    ['task-graph', taskId],
    `/api/tasks/${taskId}/graph`,
    Boolean(taskId),
  );

  if (isLoading) return <p className="hint">Loading run graph…</p>;
  if (!data) return <Empty message="No run graph available for this task." />;

  const { graph } = data;
  const activeNode = graph.nodes.find((node) => node.state === 'running');
  const isWorking = data.runState === 'running' || Boolean(activeNode);
  const completedCount = graph.nodes.filter((node) => node.state === 'completed').length;
  const activeLabel = activeNode?.id.replaceAll('_', ' ');
  const currentActivity = isWorking
    ? execution?.currentActivity ??
      execution?.activeCommandPreview ??
      (activeLabel ? `Running the ${activeLabel} step` : null)
    : null;
  // Failure edges are the interesting ones: they are the routes a user cannot
  // infer from the happy-path node list alone.
  const failureEdges = graph.edges.filter((edge) => edge.when !== 'always');
  const forwardEdges = graph.edges.filter((edge) => edge.when === 'always');
  const graphLayout = layoutGraph(graph.nodes, failureEdges.length);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const markerPrefix = `graph-${taskId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <div className="graph-run">
      <div className="graph-overview">
        <div>
          <span className="eyebrow">Governed workflow</span>
          <strong>{graph.label}</strong>
          <small>
            {completedCount} of {graph.nodes.length} steps complete · {graph.version}
          </small>
        </div>
        <StatusPill tone={NODE_TONES[data.runState] ?? 'muted'}>
          {data.runState.replaceAll('_', ' ')}
        </StatusPill>
      </div>

      {currentActivity ? (
        <div className={`graph-now${isWorking ? '' : ' idle'}`} role="status" aria-live="polite">
          <span className="graph-now-pulse" aria-hidden="true" />
          <div>
            <small>{isWorking ? 'Working now' : 'Latest activity'}</small>
            <strong>{currentActivity}</strong>
            {execution ? (
              <span>
                {execution.roleDisplayName} · attempt {execution.attempt}
                {execution.activeTool ? ` · ${execution.activeTool}` : ''}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="graph-canvas" aria-label="Visual workflow map">
        <div className="graph-legend" aria-hidden="true">
          <span className="complete">Complete</span>
          <span className="active">Active flow</span>
          <span className="exception">Return path</span>
        </div>
        <div className="graph-map" style={{ width: graphLayout.width, height: graphLayout.height }}>
          <svg
            className="graph-map-edges"
            width={graphLayout.width}
            height={graphLayout.height}
            viewBox={`0 0 ${graphLayout.width} ${graphLayout.height}`}
            aria-hidden="true"
          >
            <defs>
              <marker
                id={`${markerPrefix}-arrow`}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" className="graph-arrow-head" />
              </marker>
              <marker
                id={`${markerPrefix}-arrow-active`}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" className="graph-arrow-head-active" />
              </marker>
              <marker
                id={`${markerPrefix}-arrow-return`}
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" className="graph-arrow-head-return" />
              </marker>
            </defs>

            {forwardEdges.map((edge) => {
              const from = graphLayout.positions.get(edge.from);
              const to = graphLayout.positions.get(edge.to);
              if (!from || !to) return null;
              const state = edgeState(edge, nodesById);
              return (
                <path
                  key={`${edge.from}-${edge.to}-${edge.when}`}
                  className={`graph-edge-path graph-edge-${state}`}
                  d={forwardPath(from, to)}
                  markerEnd={`url(#${markerPrefix}-${state === 'active' ? 'arrow-active' : 'arrow'})`}
                />
              );
            })}

            {failureEdges.map((edge, index) => {
              const from = graphLayout.positions.get(edge.from);
              const to = graphLayout.positions.get(edge.to);
              if (!from || !to) return null;
              const laneY = graphLayout.returnLaneStart + index * 28;
              const labelX = (from.x + to.x + NODE_WIDTH) / 2;
              const label = EDGE_LABELS[edge.when] ?? edge.when;
              const state = edgeState(edge, nodesById);
              return (
                <g
                  key={`${edge.from}-${edge.to}-${edge.when}`}
                  className={`graph-return-edge graph-return-${state}`}
                >
                  <path
                    className="graph-edge-path"
                    d={returnPath(from, to, laneY)}
                    markerEnd={`url(#${markerPrefix}-arrow-return)`}
                  />
                  <rect
                    x={labelX - Math.max(34, label.length * 3.3)}
                    y={laneY - 11}
                    width={Math.max(68, label.length * 6.6)}
                    height="20"
                    rx="10"
                  />
                  <text x={labelX} y={laneY + 3} textAnchor="middle">
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>

          <ol className="graph-nodes" aria-label="Workflow graph nodes">
            {graph.nodes.map((node, index) => (
              <li
                key={node.id}
                className={`graph-node ${node.state}`}
                aria-current={node.state === 'running' ? 'step' : undefined}
                style={{
                  left: graphLayout.positions.get(node.id)?.x ?? 0,
                  top: graphLayout.positions.get(node.id)?.y ?? 0,
                  height: graphLayout.positions.get(node.id)?.height ?? NODE_MIN_HEIGHT,
                }}
              >
                <div className="graph-node-order" aria-hidden="true">
                  <span>{nodeMark(node, index)}</span>
                </div>
                <div className="graph-node-head">
                  <b>{node.id.replaceAll('_', ' ')}</b>
                  <StatusPill tone={NODE_TONES[node.state] ?? 'muted'}>
                    {node.state.replaceAll('_', ' ')}
                  </StatusPill>
                </div>
                <small>{nodeDescriptor(node)}</small>
                {node.focus ? <small className="graph-node-focus">{node.focus}</small> : null}
                {node.primaryProviderDisplayName && node.primaryModelDisplayName ? (
                  <span className="graph-node-model">
                    <small>Primary AI</small>
                    <b>{node.primaryProviderDisplayName}</b>
                    <span>{node.primaryModelDisplayName}</span>
                  </span>
                ) : null}
                {node.role !== node.id ? (
                  <span className="graph-node-role">{node.role.replaceAll('_', ' ')}</span>
                ) : null}
                {node.attempts > 1 ? <small>{node.attempts} runs recorded</small> : null}
                {node.dependsOn.length ? <small>after {node.dependsOn.join(', ')}</small> : null}
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="graph-meta" aria-label="Workflow limits">
        <span>Concurrency {graph.maxConcurrency}</span>
        <span>Loop budget {graph.maxLoopIterations}</span>
        <span>Read-only run projection</span>
      </div>

      {failureEdges.length ? (
        <ul className="visually-hidden" aria-label="Failure routes">
          {failureEdges.map((edge) => (
            <li key={`${edge.from}-${edge.to}-${edge.when}`}>
              {edge.from} → {edge.to} {EDGE_LABELS[edge.when] ?? edge.when}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
