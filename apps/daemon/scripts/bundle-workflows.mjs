#!/usr/bin/env node
/**
 * Copies the repository's `.roflock` templates into the daemon package.
 *
 * The loader finds `workflows/` by walking up from its own module, which works
 * in a checkout and not in a published package — there is nothing above
 * `node_modules/@roflock/daemon` to find. Bundling a copy into `dist` means the
 * same lookup succeeds either way: the built daemon finds `dist/workflows`
 * first, while tests running from `src` still walk up to the repository copy a
 * developer is editing.
 *
 * Silent fallback is the failure mode worth avoiding: without this, a published
 * daemon would quietly serve the hard-coded TypeScript graphs instead of the
 * compiled templates, and nothing would say so.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryWorkflows = join(packageRoot, '..', '..', 'workflows');
// Inside `dist`, deliberately. Bundling at the package root would shadow the
// repository copy during development, so editing a template and re-running
// tests would silently keep using the last build.
const bundled = join(packageRoot, 'dist', 'workflows');

if (!existsSync(repositoryWorkflows)) {
  // Building from an already-packaged copy: the bundle is the source.
  if (!existsSync(bundled)) {
    console.error('No workflows directory found to bundle.');
    process.exit(1);
  }
  process.exit(0);
}

rmSync(bundled, { recursive: true, force: true });
mkdirSync(bundled, { recursive: true });
const copied = readdirSync(repositoryWorkflows).filter((name) => name.endsWith('.roflock'));
if (copied.length === 0) {
  console.error(`No .roflock templates in ${repositoryWorkflows}.`);
  process.exit(1);
}
for (const name of copied) {
  cpSync(join(repositoryWorkflows, name), join(bundled, name));
}
console.log(`Bundled ${copied.length} workflow templates.`);
