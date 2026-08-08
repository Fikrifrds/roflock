import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkflowTemplates, registerWorkflowTemplates } from '@roleflock/graph-core';
import { compile } from '@roleflock/language';

/**
 * Loads `workflows/*.roflock` and registers the compiled templates.
 *
 * This is where the built-in workflows stop being TypeScript. The daemon reads
 * source, compiles it through the same public compiler a user's own workflow
 * goes through, and hands the result to `graph-core` — so there is no
 * privileged path for shipped workflows.
 *
 * Failure is loud but not fatal. If a template no longer compiles, the resolver
 * falls back to the hard-coded definition for that mode, which means a broken
 * template degrades the daemon to today's behaviour rather than leaving it with
 * no workflows at all. The operator still gets told.
 */

const WORKFLOW_EXTENSION = '.roflock';

export interface TemplateLoadResult {
  loaded: string[];
  failures: Array<{ id: string; reasons: string[] }>;
}

/**
 * Finds the `.roflock` templates, in a package or in a checkout.
 *
 * A published package has nothing above `node_modules/@roflock/daemon` to walk
 * up to, so the build bundles a copy into the package and that copy is checked
 * first. Walking up still works in a checkout, where the repository copy is the
 * one a developer is editing.
 */
function findWorkflowsDirectory(from: string): string | undefined {
  let current = from;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(current, 'workflows');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

export function loadWorkflowTemplates(directory?: string): TemplateLoadResult {
  const root = directory ?? findWorkflowsDirectory(dirname(fileURLToPath(import.meta.url)));
  if (root === undefined || !existsSync(root)) {
    registerWorkflowTemplates([]);
    return { loaded: [], failures: [] };
  }

  const sources: Array<{
    id: string;
    ir: NonNullable<ReturnType<typeof compile>['ir']>;
    source: string;
  }> = [];
  const failures: Array<{ id: string; reasons: string[] }> = [];

  for (const entry of readdirSync(root).sort()) {
    if (!entry.endsWith(WORKFLOW_EXTENSION)) continue;
    const path = resolve(root, entry);
    const id = entry.slice(0, -WORKFLOW_EXTENSION.length);
    const text = readFileSync(path, 'utf8');
    const compiled = compile(text, { uri: path });
    if (!compiled.ir) {
      failures.push({
        id,
        reasons: compiled.diagnostics
          .filter((diagnostic) => diagnostic.severity === 'error')
          .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
      });
      continue;
    }
    sources.push({ id, ir: compiled.ir, source: text });
  }

  const built = buildWorkflowTemplates(sources);
  registerWorkflowTemplates(built.templates);

  return {
    loaded: built.templates.map((template) => template.graph.id).sort(),
    failures: [...failures, ...built.failures],
  };
}
