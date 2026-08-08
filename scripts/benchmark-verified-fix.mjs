#!/usr/bin/env node
/**
 * Local Verified Fix baseline — times lightweight fixtures that mirror the
 * walking skeleton (context compile + sandboxed command). Does not upload data.
 *
 * Compare vs direct Cursor/Claude agent manually using the methodology below.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'docs/benchmarks/baseline.md');

async function loadModules() {
  try {
    const [compiler, runner] = await Promise.all([
      import(join(ROOT, 'packages/context-compiler/dist/index.js')),
      import(join(ROOT, 'packages/command-runner/dist/index.js')),
    ]);
    return { compileContext: compiler.compileContext, runCommand: runner.runCommand };
  } catch {
    return null;
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

async function benchCompile(compileContext, iterations = 200) {
  const items = [
    { id: 'brief', source: 'task.brief', content: 'Fix redirect on login', priority: 100 },
    {
      id: 'doc',
      source: 'document:spec.md',
      content: 'Expected: home. Actual: 404.',
      priority: 50,
    },
    { id: 'env', source: 'file:.env', path: '.env', content: 'SECRET=1', priority: 1000 },
  ];
  const samples = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    compileContext({ role: 'planner', items });
    samples.push(performance.now() - start);
  }
  return {
    iterations,
    medianMs: median(samples),
    p95Ms: percentile(samples, 0.95),
    totalMs: samples.reduce((a, b) => a + b, 0),
  };
}

async function benchCommand(runCommand, iterations = 20) {
  const sandbox = await mkdtemp(join(tmpdir(), 'rf-bench-'));
  await writeFile(join(sandbox, 'README.md'), '# bench\n');
  const samples = [];
  try {
    for (let i = 0; i < iterations; i += 1) {
      const start = performance.now();
      await runCommand({
        command: 'echo',
        args: ['roflock-bench'],
        cwd: sandbox,
        sandboxRoot: sandbox,
      });
      samples.push(performance.now() - start);
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
  return {
    iterations,
    medianMs: median(samples),
    p95Ms: percentile(samples, 0.95),
    totalMs: samples.reduce((a, b) => a + b, 0),
  };
}

function renderMarkdown(report) {
  const { generatedAt, fixture, compile, command, note } = report;
  return `# Verified Fix baseline (local fixture)

**Generated:** ${generatedAt}
**Fixture:** ${fixture}

These numbers time **local Roflock components** (context compile + sandboxed \`echo\`), not a full end-to-end provider run. Label: **local fixture** — not marketing benchmarks.

## Results

| Step | Iterations | Median (ms) | p95 (ms) | Total (ms) |
|------|------------|-------------|----------|------------|
| Context compile (planner, incl. .env deny) | ${compile.iterations} | ${compile.medianMs.toFixed(3)} | ${compile.p95Ms.toFixed(3)} | ${compile.totalMs.toFixed(1)} |
| Command runner (\`echo\` in sandbox) | ${command.iterations} | ${command.medianMs.toFixed(3)} | ${command.p95Ms.toFixed(3)} | ${command.totalMs.toFixed(1)} |

## Methodology — compare vs direct agent

1. **Roflock path:** \`ROFLOCK_FORCE_FAKE=1 pnpm dev\`, run Verified Fix on a small repo; note wall-clock from Start → Accept.
2. **Direct agent path:** Same brief in Cursor/Claude without a Roflock graph; note wall-clock to equivalent patch + manual test.
3. **Compare:** Roflock adds approval gates, evidence, and disclosure overhead; direct agent may be faster but lacks governed leases and exportable audit.

Full walking skeleton E2E timing: \`pnpm test apps/daemon/test/walking-skeleton.test.ts\` (automated, fake provider).

## Reproduce

\`\`\`bash
pnpm build
pnpm benchmark
\`\`\`

${note}
`;
}

async function main() {
  const modules = await loadModules();
  const generatedAt = new Date().toISOString();

  if (!modules) {
    const placeholder = renderMarkdown({
      generatedAt,
      fixture: 'local fixture (build required — run `pnpm build` first)',
      compile: { iterations: 0, medianMs: 0, p95Ms: 0, totalMs: 0 },
      command: { iterations: 0, medianMs: 0, p95Ms: 0, totalMs: 0 },
      note: '> **Placeholder:** dist packages missing. Run `pnpm build && pnpm benchmark` for measured numbers.',
    });
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, placeholder);
    console.log('Wrote placeholder baseline (build packages first for timings).');
    console.log(BASELINE_PATH);
    return;
  }

  const compile = await benchCompile(modules.compileContext);
  const command = await benchCommand(modules.runCommand);
  const markdown = renderMarkdown({
    generatedAt,
    fixture: 'local fixture (built packages/context-compiler + command-runner)',
    compile,
    command,
    note: 'Update checks and this benchmark never transmit repository contents.',
  });

  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, markdown);
  console.log(JSON.stringify({ generatedAt, compile, command, writtenTo: BASELINE_PATH }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
