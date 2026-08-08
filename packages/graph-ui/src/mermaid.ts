import type { GraphLayout, LaidOutEdge, LaidOutNode } from './layout.js';

/**
 * Mermaid rendering of a laid-out graph.
 *
 * Text rather than pixels, so a workflow diagram works in a terminal, a README,
 * a pull request and the docs without any of them needing a renderer Roflock
 * ships. It is also the only rendering that can be asserted on in a test, which
 * is why the shared model is proven here before any canvas exists.
 */

/** Mermaid node ids may not contain the punctuation a workflow id can. */
function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, '_');
}

function escapeLabel(text: string): string {
  return text.replace(/"/g, "'");
}

/**
 * Shape carries meaning: a reader should be able to tell a deterministic check
 * from an agent's judgement without reading the legend.
 */
function nodeShape(node: LaidOutNode): [string, string] {
  switch (node.shape) {
    case 'check':
      return ['{{', '}}'];
    case 'human':
      return ['[/', '/]'];
    case 'terminal':
      return ['([', '])'];
    case 'action':
      return ['[[', ']]'];
    case 'control':
      return ['((', '))'];
    default:
      return ['[', ']'];
  }
}

function badgeSuffix(node: LaidOutNode): string {
  const marks: string[] = [];
  // Each of these changes what a reader should conclude, so none is decoration.
  if (node.badges.writer) marks.push('writer');
  if (node.badges.required) marks.push('required');
  if (node.badges.protectedEffect) marks.push('protected');
  return marks.length === 0 ? '' : ` (${marks.join(', ')})`;
}

function edgeArrow(edge: LaidOutEdge): string {
  const label = edge.guard === undefined ? edge.outcome : `${edge.outcome} · ${edge.guard}`;
  // A dotted line for a failure route: the happy path should be the one the eye
  // follows first.
  return edge.kind === 'success' ? `-- "${label}" -->` : `-. "${label}" .->`;
}

export interface MermaidOptions {
  /** Include a legend explaining the shapes and badges. */
  legend?: boolean;
}

export function toMermaid(layout: GraphLayout, options: MermaidOptions = {}): string {
  const lines: string[] = ['flowchart TD'];

  for (const node of layout.nodes) {
    const [open, close] = nodeShape(node);
    lines.push(
      `  ${safeId(node.id)}${open}"${escapeLabel(node.label)}${badgeSuffix(node)}"${close}`,
    );
  }

  if (layout.edges.length > 0) lines.push('');
  for (const edge of layout.edges) {
    lines.push(`  ${safeId(edge.from)} ${edgeArrow(edge)} ${safeId(edge.to)}`);
  }

  for (const loop of layout.loops) {
    lines.push('');
    // The budget is the single most load-bearing number in a repair loop, so it
    // is drawn rather than left for the reader to find in the source.
    lines.push(
      `  %% loop ${loop.id}: ${loop.nodeIds.join(' → ')} · max ${loop.maxAttempts} attempts · verified by ${loop.verifierNodeId}`,
    );
  }

  if (options.legend === true) {
    lines.push('');
    lines.push('  %% [ ] agent   {{ }} deterministic check   [/ /] human gate');
    lines.push('  %% ([ ]) accepted terminal   solid = success   dotted = failure route');
  }

  return lines.join('\n');
}
