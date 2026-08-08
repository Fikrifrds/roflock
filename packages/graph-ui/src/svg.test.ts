import { compile } from '@roleflock/language';
import { describe, expect, it } from 'vitest';
import { layoutGraph } from './layout.js';
import { toSvg } from './svg.js';

const BUG_FIX = `
workflow BugFix { version "1.0.0" max_cost 5 }
role builder { write }
role critic { readonly }
agent Build { role builder objective "build" retry 2 }
check Tests { run "npm test" required }
agent Verify { role critic objective "verify" reviews }
human Accept
flow {
  Build -> Tests
  Tests.pass -> Verify
  Verify -> Accept
  Tests.fail -> Build { max 3 }
}
`;

function svg(source = BUG_FIX, state?: Parameters<typeof layoutGraph>[1]) {
  const compiled = compile(source, { uri: 'x.roflock' });
  if (!compiled.ir) throw new Error(compiled.diagnostics.map((d) => d.message).join('\n'));
  return toSvg(layoutGraph(compiled.ir, state ?? {}));
}

describe('drawing a workflow', () => {
  it('includes every node', () => {
    const drawing = svg();

    for (const id of ['Build', 'Tests', 'Verify', 'Accept']) {
      expect(drawing).toContain(`>${id}<`);
    }
  });

  it('draws both the happy path and the failure route', () => {
    const drawing = svg();

    // A diagram that quietly omitted the repair route would misrepresent the
    // workflow's safety, which is the whole reason to draw it.
    expect(drawing).toContain('Build —completed→ Tests');
    expect(drawing).toContain('Tests —fail→ Build');
    expect(drawing).toContain('stroke-dasharray');
  });

  it('marks the facts a reader needs at a glance', () => {
    const drawing = svg();

    expect(drawing).toContain('writer');
    expect(drawing).toContain('required');
  });

  it('shows live run state when a run supplied it', () => {
    const drawing = svg(BUG_FIX, {
      state: {
        Build: { state: 'settled', outcome: 'completed' },
        Tests: { state: 'running' },
      },
    });

    // Distinct fills, so a glance tells a reader where the run is.
    expect(drawing).toContain('#ecfdf5');
    expect(drawing).toContain('#fef9c3');
  });

  it('is deterministic', () => {
    expect(svg()).toBe(svg());
  });

  it('is well-formed and self-describing', () => {
    const drawing = svg();

    expect(drawing.startsWith('<svg')).toBe(true);
    expect(drawing.endsWith('</svg>')).toBe(true);
    expect(drawing).toContain('role="img"');
    expect(drawing).toContain('aria-label="Workflow BugFix"');
  });

  it('escapes text rather than letting it break the document', () => {
    const drawing = toSvg(
      {
        workflowId: 'x',
        workflowName: 'A & B <script>',
        nodes: [
          {
            id: 'n',
            label: 'a "quoted" <tag> & more',
            shape: 'agent',
            badges: {
              writer: false,
              required: false,
              human: false,
              looping: false,
              protectedEffect: false,
            },
            rank: 0,
            order: 0,
          },
        ],
        edges: [],
        ranks: [['n']],
        loops: [],
      },
      {},
    );

    expect(drawing).not.toContain('<script>');
    expect(drawing).toContain('&amp;');
    expect(drawing).toContain('&lt;tag&gt;');
    expect(drawing).toContain('&quot;quoted&quot;');
  });
});
