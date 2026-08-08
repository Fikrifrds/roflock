import type { GraphLayout, LaidOutNode } from './layout.js';

/**
 * Renders a laid-out graph as an SVG string.
 *
 * A string rather than a component, so the Playground, Studio and anything else
 * draw the *same* picture instead of each writing its own view. It also makes the
 * drawing testable: a diagram that quietly omitted a failure route would
 * misrepresent a workflow's safety, and that is worth asserting rather than
 * eyeballing.
 *
 * Framework-free on purpose. `graph-ui` must stay importable by a browser bundle,
 * a Node CLI and a test with no DOM, and adding React here would end that.
 */

const COLUMN = 190;
const ROW = 96;
const NODE_WIDTH = 158;
const NODE_HEIGHT = 46;
const PADDING = 26;

export interface SvgOptions {
  /** Accessible name for the whole figure. */
  title?: string;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Each badge changes what a reader should conclude, so none is decoration. */
function badgeText(node: LaidOutNode): string {
  const marks: string[] = [];
  if (node.badges.writer) marks.push('writer');
  if (node.badges.required) marks.push('required');
  if (node.badges.protectedEffect) marks.push('protected');
  return marks.join(' · ');
}

/** Live state, when a run supplied it. Absent states are left unstyled. */
function stateFill(node: LaidOutNode): string {
  if (node.state === 'running') return '#fef9c3';
  if (node.state === 'settled') return node.outcome === 'completed' ? '#ecfdf5' : '#fef2f2';
  return '#f8fafc';
}

export function toSvg(layout: GraphLayout, options: SvgOptions = {}): string {
  const widest = Math.max(1, ...layout.ranks.map((rank) => rank.length));
  const positions = new Map(
    layout.nodes.map(
      (node) =>
        [
          node.id,
          { x: PADDING + NODE_WIDTH / 2 + node.order * COLUMN, y: PADDING + node.rank * ROW },
        ] as const,
    ),
  );
  const width = PADDING * 2 + NODE_WIDTH + (widest - 1) * COLUMN;
  const height = PADDING * 2 + (layout.ranks.length - 1) * ROW + NODE_HEIGHT;
  const label = options.title ?? `Workflow ${layout.workflowName}`;

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(label)}" viewBox="0 0 ${width} ${height}" style="width:100%;height:auto">`,
    '<defs><marker id="rf-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor"/></marker></defs>',
  ];

  for (const edge of layout.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    const failure = edge.kind === 'failure';
    // A failure route is dashed and bowed out to the side, so the happy path is
    // the line the eye follows first.
    const offset = failure ? NODE_WIDTH / 2 + 16 : 0;
    const path = failure
      ? `M ${from.x + offset} ${from.y} C ${from.x + offset + 62} ${from.y}, ${to.x + offset + 62} ${to.y}, ${to.x + offset} ${to.y}`
      : `M ${from.x} ${from.y + NODE_HEIGHT / 2} L ${to.x} ${to.y - NODE_HEIGHT / 2}`;
    parts.push(
      `<g color="${failure ? '#b45309' : '#475569'}"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.5"${failure ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#rf-arrow)"/><title>${escapeXml(`${edge.from} —${edge.outcome}→ ${edge.to}`)}</title></g>`,
    );
  }

  for (const node of layout.nodes) {
    const at = positions.get(node.id)!;
    const badges = badgeText(node);
    const radius = node.shape === 'terminal' ? NODE_HEIGHT / 2 : 8;
    parts.push(
      `<g transform="translate(${at.x - NODE_WIDTH / 2},${at.y - NODE_HEIGHT / 2})">`,
      `<rect width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="${radius}" fill="${stateFill(node)}" stroke="${node.badges.writer ? '#b45309' : '#94a3b8'}" stroke-width="${node.badges.writer ? 2 : 1}"/>`,
      `<text x="${NODE_WIDTH / 2}" y="${badges ? 20 : 28}" text-anchor="middle" font-size="13" fill="#0f172a">${escapeXml(node.label)}</text>`,
      badges
        ? `<text x="${NODE_WIDTH / 2}" y="35" text-anchor="middle" font-size="10" fill="#64748b">${escapeXml(badges)}</text>`
        : '',
      '</g>',
    );
  }

  parts.push('</svg>');
  return parts.filter(Boolean).join('');
}
