import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '../..');
const outdir = join(packageRoot, 'dist');

// The published daemon is also the local Studio server. Build the browser app
// here so CLI builds and npm prepack never depend on an earlier workspace build.
execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['--dir', 'apps/web', 'build'], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});

const internalPackages = new Map();
const packagesDirectory = join(repositoryRoot, 'packages');
for (const directory of readdirSync(packagesDirectory)) {
  const manifestPath = join(packagesDirectory, directory, 'package.json');
  const sourceEntry = join(packagesDirectory, directory, 'src', 'index.ts');
  if (!existsSync(manifestPath) || !existsSync(sourceEntry)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.name === 'string' && manifest.name.startsWith('@roleflock/')) {
    internalPackages.set(manifest.name, dirname(sourceEntry));
  }
}

const internalWorkspacePlugin = {
  name: 'internal-workspace-packages',
  setup(build) {
    build.onResolve({ filter: /^@roleflock\/[a-z0-9-]+(?:\/.*)?$/ }, (args) => {
      const segments = args.path.split('/');
      const packageName = segments.slice(0, 2).join('/');
      const sourceDirectory = internalPackages.get(packageName);
      if (!sourceDirectory) return undefined;
      const subpath = segments.slice(2).join('/');
      const candidate = join(sourceDirectory, subpath ? `${subpath}.ts` : 'index.ts');
      if (!existsSync(candidate)) {
        return { errors: [{ text: `No source entry for internal import ${args.path}` }] };
      }
      return { path: candidate };
    });
  },
};

rmSync(outdir, { recursive: true, force: true });

await build({
  absWorkingDir: repositoryRoot,
  entryPoints: {
    'bin/roflock': 'apps/cli/src/bin/roflock.ts',
    'bin/roflock-lsp': 'apps/cli/src/bin/roflock-lsp.ts',
    'bin/roflock-mcp': 'apps/cli/src/bin/roflock-mcp.ts',
    'bin/roleflock': 'apps/cli/src/bin/roleflock.ts',
    'daemon/index': 'apps/daemon/src/index.ts',
  },
  outdir,
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  legalComments: 'none',
  chunkNames: 'chunks/[name]-[hash]',
  plugins: [internalWorkspacePlugin],
  external: ['@fastify/cookie', '@fastify/static', 'better-sqlite3', 'fastify'],
});

const workflowSource = join(repositoryRoot, 'workflows');
const workflowTarget = join(outdir, 'daemon', 'workflows');
mkdirSync(workflowTarget, { recursive: true });
for (const filename of readdirSync(workflowSource)) {
  if (filename.endsWith('.roflock')) {
    cpSync(join(workflowSource, filename), join(workflowTarget, filename));
  }
}

cpSync(join(repositoryRoot, 'apps', 'web', 'dist'), join(outdir, 'daemon', 'web'), {
  recursive: true,
});

cpSync(join(repositoryRoot, 'LICENSE'), join(outdir, 'LICENSE'));
