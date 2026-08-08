import type { GraphLayout, LaidOutNode } from '@roleflock/graph-ui';

/**
 * Draws a laid-out graph as SVG.
 *
 * Deliberately renders from the shared layout model rather than computing its
 * own positions, so the Playground, Studio and `roflock render` cannot disagree
 * about what a workflow does. Positions here are arithmetic on rank and order —
 * there is no layout algorithm in the view.
 */

const COLUMN = 190;
const ROW = 96;
const NODE_WIDTH = 158;
const NODE_HEIGHT = 46;
const PADDING = 24;

function centreOf(node: LaidOutNode, widest: number): { x: number; y: number } {
  return {
    x: PADDING + (widest - 1) * (COLUMN / 2) - (node.order - 0) * 0 + node.order * COLUMN,
    y: PADDING + node.rank * ROW,
  };
}

/** Each badge changes what a reader should conclude, so none is decoration. */
function badgeText(node: LaidOutNode): string {
  const marks: string[] = [];
  if (node.badges.writer) marks.push('writer');
  if (node.badges.required) marks.push('required');
  if (node.badges.protectedEffect) marks.push('protected');
  return marks.join(' · ');
}

export function GraphDiagram({ layout }: { layout: GraphLayout }) {
  const widest = Math.max(1, ...layout.ranks.map((rank) => rank.length));
  const positions = new Map(layout.nodes.map((node) => [node.id, centreOf(node, widest)] as const));
  const width = PADDING * 2 + widest * COLUMN;
  const height = PADDING * 2 + layout.ranks.length * ROW;

  return (
    <svg
      role="img"
      aria-label={`Workflow ${layout.workflowName}`}
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: 'auto' }}
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
        </marker>
      </defs>

      {layout.edges.map((edge) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return null;
        const failure = edge.kind === 'failure';
        // A failure route is dashed and offset, so the happy path is the line the
        // eye follows first.
        const offset = failure ? NODE_WIDTH / 2 + 14 : 0;
        return (
          <g key={edge.id} color={failure ? '#b45309' : '#475569'}>
            <path
              d={
                failure
                  ? `M ${from.x + offset} ${from.y} C ${from.x + offset + 60} ${from.y}, ${to.x + offset + 60} ${to.y}, ${to.x + offset} ${to.y}`
                  : `M ${from.x} ${from.y + NODE_HEIGHT / 2} L ${to.x} ${to.y - NODE_HEIGHT / 2}`
              }
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeDasharray={failure ? '5 4' : undefined}
              markerEnd="url(#arrow)"
            />
            <title>{`${edge.from} —${edge.outcome}→ ${edge.to}`}</title>
          </g>
        );
      })}

      {layout.nodes.map((node) => {
        const at = positions.get(node.id)!;
        const badges = badgeText(node);
        return (
          <g
            key={node.id}
            transform={`translate(${at.x - NODE_WIDTH / 2}, ${at.y - NODE_HEIGHT / 2})`}
          >
            <rect
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx={node.shape === 'terminal' ? NODE_HEIGHT / 2 : 8}
              fill="#f8fafc"
              stroke={node.badges.writer ? '#b45309' : '#94a3b8'}
              strokeWidth={node.badges.writer ? 2 : 1}
            />
            <text
              x={NODE_WIDTH / 2}
              y={badges ? 20 : 28}
              textAnchor="middle"
              fontSize={13}
              fill="#0f172a"
            >
              {node.label}
            </text>
            {badges ? (
              <text x={NODE_WIDTH / 2} y={35} textAnchor="middle" fontSize={10} fill="#64748b">
                {badges}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
