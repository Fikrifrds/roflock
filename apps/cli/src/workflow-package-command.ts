import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { compile } from '@roleflock/language';
import { ExitCode } from './exit-codes.js';
import type { CliIo } from './main.js';
import { emitUsageError } from './runtime-output.js';

const MANIFEST_FILE = 'roflock.workflow.json';
const LOCK_FILE = 'roflock-workflows.lock.json';
const NAME = /^[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

interface WorkflowPackageManifest {
  schemaVersion: 1;
  name: string;
  version: string;
  workflows: string[];
  description?: string;
}

interface VerifiedPackage {
  directory: string;
  manifest: WorkflowPackageManifest;
  files: Array<{ path: string; source: string; workflowId: string; semanticHash?: string }>;
  integrity: string;
}

interface Lockfile {
  schemaVersion: 1;
  packages: Record<
    string,
    {
      version: string;
      integrity: string;
      source: string;
      workflows: Array<{ path: string; semanticHash?: string }>;
    }
  >;
}

class PackageError extends Error {}

function parseManifest(directory: string): WorkflowPackageManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(directory, MANIFEST_FILE), 'utf8'));
  } catch {
    throw new PackageError(`Cannot read ${MANIFEST_FILE} in '${directory}'`);
  }
  if (typeof raw !== 'object' || raw === null)
    throw new PackageError('Workflow package manifest must be an object');
  const value = raw as Partial<WorkflowPackageManifest>;
  if (value.schemaVersion !== 1) throw new PackageError('Workflow package schemaVersion must be 1');
  if (typeof value.name !== 'string' || !NAME.test(value.name)) {
    throw new PackageError(
      'Workflow package name must use lowercase letters, digits, dots, underscores, or hyphens',
    );
  }
  if (typeof value.version !== 'string' || !VERSION.test(value.version)) {
    throw new PackageError('Workflow package version must be SemVer, for example 1.2.3');
  }
  if (
    !Array.isArray(value.workflows) ||
    value.workflows.length === 0 ||
    value.workflows.some((path) => typeof path !== 'string')
  ) {
    throw new PackageError(
      'Workflow package workflows must be a non-empty array of relative .roflock paths',
    );
  }
  if (typeof value.description !== 'undefined' && typeof value.description !== 'string') {
    throw new PackageError('Workflow package description must be a string when present');
  }
  return {
    schemaVersion: 1,
    name: value.name,
    version: value.version,
    workflows: [...value.workflows],
    ...(value.description === undefined ? {} : { description: value.description }),
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function verifyWorkflowPackage(directory: string): VerifiedPackage {
  const root = realpathSync(directory);
  const manifest = parseManifest(root);
  const seen = new Set<string>();
  const files = manifest.workflows.map((declared) => {
    if (isAbsolute(declared) || !declared.endsWith('.roflock') || declared.includes('\0')) {
      throw new PackageError(`Workflow path '${declared}' must be a relative .roflock file`);
    }
    const path = resolve(root, declared);
    if (relative(root, path).startsWith('..'))
      throw new PackageError(`Workflow path '${declared}' escapes the package`);
    let realPath: string;
    try {
      realPath = realpathSync(path);
    } catch {
      throw new PackageError(`Cannot read workflow '${declared}'`);
    }
    if (relative(root, realPath).startsWith('..') || realPath !== path) {
      throw new PackageError(
        `Workflow path '${declared}' must be a real file inside the package, not a symlink`,
      );
    }
    const canonical = relative(root, path).replaceAll('\\', '/');
    if (seen.has(canonical))
      throw new PackageError(`Workflow path '${declared}' is listed more than once`);
    seen.add(canonical);
    const source = readFileSync(path, 'utf8');
    const compiled = compile(source, { uri: path });
    const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    if (!compiled.ir || errors.length > 0) {
      throw new PackageError(
        `Workflow '${declared}' does not compile: ${errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('; ')}`,
      );
    }
    return {
      path: canonical,
      source,
      workflowId: compiled.ir.workflow.id,
      ...(compiled.ir.workflow.semanticHash === undefined
        ? {}
        : { semanticHash: compiled.ir.workflow.semanticHash }),
    };
  });
  const integrity = createHash('sha256')
    .update(stable({ manifest, files: files.map(({ path, source }) => ({ path, source })) }))
    .digest('hex');
  return { directory: root, manifest, files, integrity };
}

function projectPaths(project: string) {
  const root = resolve(project);
  return {
    root,
    packageRoot: join(root, '.roflock', 'packages'),
    lock: join(root, '.roflock', LOCK_FILE),
  };
}

function readLock(path: string): Lockfile {
  if (!existsSync(path)) return { schemaVersion: 1, packages: {} };
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<Lockfile>;
    if (value.schemaVersion !== 1 || !value.packages || typeof value.packages !== 'object')
      throw new Error();
    return { schemaVersion: 1, packages: value.packages };
  } catch {
    throw new PackageError(`Invalid Roflock workflow lockfile '${path}'`);
  }
}

function writeLock(path: string, lock: Lockfile): void {
  const packages = Object.fromEntries(
    Object.entries(lock.packages).sort(([left], [right]) => left.localeCompare(right)),
  );
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, packages }, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'w',
  });
}

export function installWorkflowPackage(directory: string, project = process.cwd()) {
  const verified = verifyWorkflowPackage(directory);
  const paths = projectPaths(project);
  const lock = readLock(paths.lock);
  const prior = lock.packages[verified.manifest.name];
  if (
    prior &&
    prior.version === verified.manifest.version &&
    prior.integrity === verified.integrity
  ) {
    return {
      installed: false,
      package: verified,
      target: join(paths.packageRoot, verified.manifest.name, verified.manifest.version),
    };
  }
  if (prior) {
    throw new PackageError(
      `Workflow package '${verified.manifest.name}' is already locked at ${prior.version}. Update requires an explicit future package-update command.`,
    );
  }
  const target = join(paths.packageRoot, verified.manifest.name, verified.manifest.version);
  if (existsSync(target))
    throw new PackageError(
      `Target '${target}' already exists and is not represented by the lockfile`,
    );

  // All validation and collision checks finish before the first write. Copy only
  // the declared manifest and source files; package directories cannot smuggle
  // hooks, credentials, node_modules, or other executable payloads.
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, MANIFEST_FILE), `${JSON.stringify(verified.manifest, null, 2)}\n`);
  for (const file of verified.files) {
    const output = join(target, file.path);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, file.source);
  }
  lock.packages[verified.manifest.name] = {
    version: verified.manifest.version,
    integrity: verified.integrity,
    source: `file:${verified.directory}`,
    workflows: verified.files.map((file) => ({
      path: file.path,
      ...(file.semanticHash === undefined ? {} : { semanticHash: file.semanticHash }),
    })),
  };
  writeLock(paths.lock, lock);
  return { installed: true, package: verified, target };
}

function parse(args: string[]): {
  action: 'validate' | 'install' | 'list';
  directory?: string;
  project: string;
  json: boolean;
} {
  const [action, ...rest] = args;
  if (!['validate', 'install', 'list'].includes(action ?? '')) {
    throw new PackageError(
      'Usage: roflock workflow <validate|install|list> [directory] [--project <directory>] [--json]',
    );
  }
  const parsedAction = action as 'validate' | 'install' | 'list';
  const positional: string[] = [];
  let project = process.cwd();
  let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (arg === '--json') json = true;
    else if (arg === '--project') {
      const value = rest[index + 1];
      if (!value) throw new PackageError('--project needs a directory');
      project = value;
      index += 1;
    } else if (arg.startsWith('-')) throw new PackageError(`Unknown option '${arg}'`);
    else positional.push(arg);
  }
  if (parsedAction === 'list' && positional.length !== 0)
    throw new PackageError('workflow list takes no package directory');
  if (parsedAction !== 'list' && positional.length !== 1)
    throw new PackageError(`workflow ${parsedAction} needs one package directory`);
  return {
    action: parsedAction,
    ...(positional[0] === undefined ? {} : { directory: positional[0] }),
    project,
    json,
  };
}

export function runWorkflowPackage(args: string[], io: CliIo): number {
  let options: ReturnType<typeof parse>;
  try {
    options = parse(args);
    if (options.action === 'list') {
      const lock = readLock(projectPaths(options.project).lock);
      const packages = Object.entries(lock.packages).map(([name, details]) => ({
        name,
        ...details,
      }));
      if (options.json) io.stdout(JSON.stringify({ schemaVersion: 1, packages }));
      else if (packages.length === 0) io.stdout('No workflow packages are installed.');
      else
        for (const entry of packages)
          io.stdout(`${entry.name}@${entry.version}  ${entry.integrity}`);
      return ExitCode.Ok;
    }
    if (!options.directory) throw new PackageError('Package directory is required');
    if (options.action === 'validate') {
      const verified = verifyWorkflowPackage(options.directory);
      const result = {
        valid: true,
        name: verified.manifest.name,
        version: verified.manifest.version,
        integrity: verified.integrity,
        workflows: verified.files.map(({ path, workflowId, semanticHash }) => ({
          path,
          workflowId,
          semanticHash,
        })),
      };
      if (options.json) io.stdout(JSON.stringify(result));
      else {
        io.stdout(`${result.name}@${result.version} is valid.`);
        io.stdout(`Integrity: ${result.integrity}`);
        for (const workflow of result.workflows)
          io.stdout(`${workflow.path} → ${workflow.workflowId} (${workflow.semanticHash})`);
      }
      return ExitCode.Ok;
    }
    const result = installWorkflowPackage(options.directory, options.project);
    const output = {
      installed: result.installed,
      name: result.package.manifest.name,
      version: result.package.manifest.version,
      integrity: result.package.integrity,
      target: result.target,
    };
    if (options.json) io.stdout(JSON.stringify(output));
    else
      io.stdout(
        result.installed
          ? `Installed ${output.name}@${output.version} at ${output.target}.`
          : `${output.name}@${output.version} is already installed.`,
      );
    return ExitCode.Ok;
  } catch (error) {
    return emitUsageError(
      error instanceof Error ? error.message : 'Workflow package command failed',
      args,
      io,
    );
  }
}
