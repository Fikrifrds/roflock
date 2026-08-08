import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const cliManifest = JSON.parse(readFileSync(resolve(root, 'apps/cli/package.json'), 'utf8'));
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--out' || !args[1])) {
  throw new Error('Usage: node scripts/generate-sbom.mjs [--out <path>]');
}
const output = args[1];

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const listed = spawnSync(
  pnpm,
  ['--filter', 'roflock', 'list', '--prod', '--depth', 'Infinity', '--json'],
  {
    cwd: root,
    encoding: 'utf8',
  },
);
if (listed.status !== 0) {
  throw new Error(
    `Could not enumerate production dependencies:\n${listed.stderr || listed.stdout}`,
  );
}

const [tree] = JSON.parse(listed.stdout);
if (!tree || typeof tree !== 'object')
  throw new Error('pnpm returned no production dependency tree');

const components = new Map();
const relationships = new Map();
function reference(name, version) {
  return `pkg:npm/${name.replace('@', '%40')}@${version}`;
}
function walk(name, node) {
  if (!node || typeof node !== 'object' || typeof node.version !== 'string') return undefined;
  if (node.version.startsWith('link:')) return undefined;
  const ref = reference(name, node.version);
  if (!components.has(ref)) {
    components.set(ref, {
      type: 'library',
      'bom-ref': ref,
      name,
      version: node.version,
      purl: ref,
      ...(typeof node.resolved === 'string'
        ? { externalReferences: [{ type: 'distribution', url: node.resolved }] }
        : {}),
    });
  }
  const children =
    node.dependencies && typeof node.dependencies === 'object' ? node.dependencies : {};
  const refs = new Set();
  for (const [childName, childNode] of Object.entries(children)) {
    const childRef = walk(childName, childNode);
    if (childRef) refs.add(childRef);
  }
  relationships.set(ref, refs);
  return ref;
}

const rootDependencies = new Set();
for (const [name, node] of Object.entries(tree.dependencies ?? {})) {
  const ref = walk(name, node);
  if (ref) rootDependencies.add(ref);
}

const rootRef = reference(cliManifest.name, cliManifest.version);
const bom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: 'application',
      'bom-ref': rootRef,
      name: cliManifest.name,
      version: cliManifest.version,
      licenses: [{ license: { id: cliManifest.license } }],
      purl: rootRef,
    },
    tools: [{ vendor: 'Roflock', name: 'scripts/generate-sbom.mjs' }],
  },
  components: [...components.values()].sort((left, right) =>
    left['bom-ref'].localeCompare(right['bom-ref']),
  ),
  dependencies: [
    { ref: rootRef, dependsOn: [...rootDependencies].sort() },
    ...[...relationships.entries()]
      .map(([ref, refs]) => ({ ref, dependsOn: [...refs].sort() }))
      .sort((left, right) => left.ref.localeCompare(right.ref)),
  ],
};

const serialized = `${JSON.stringify(bom, null, 2)}\n`;
if (output) {
  const target = resolve(root, output);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, serialized);
  process.stdout.write(`${target}\n`);
} else process.stdout.write(serialized);
