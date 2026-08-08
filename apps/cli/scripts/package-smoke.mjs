import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'roflock-package-smoke-'));
const packDirectory = join(scratch, 'pack');
const installDirectory = join(scratch, 'install');
const fixtureDirectory = join(scratch, 'fixture');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
    env: { ...process.env, CI: 'true', ...(options.env ?? {}) },
  });
  if (result.status !== 0) {
    throw new Error(
      [`${command} ${args.join(' ')} failed (${result.status})`, result.stdout, result.stderr]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return result.stdout;
}

function packMetadata(output) {
  const start = Math.max(output.lastIndexOf('\n['), output.startsWith('[') ? 0 : -1);
  if (start < 0) throw new Error(`npm pack did not return JSON metadata:\n${output}`);
  const parsed = JSON.parse(output.slice(start === 0 ? 0 : start + 1));
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error('npm pack returned an unexpected package count');
  }
  return parsed[0];
}

try {
  mkdirSync(packDirectory, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.name !== 'roflock' || manifest.private === true) {
    throw new Error('package must be the public unscoped roflock artifact');
  }
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (name.startsWith('@roleflock/') || String(version).startsWith('workspace:')) {
      throw new Error(`private workspace dependency leaked into package closure: ${name}`);
    }
  }

  const packed = packMetadata(
    run(npm, ['pack', '--json', '--pack-destination', packDirectory], { cwd: packageRoot }),
  );
  const files = new Set(packed.files.map((file) => file.path));
  const required = [
    'README.md',
    'package.json',
    'dist/LICENSE',
    'dist/bin/roflock.js',
    'dist/bin/roleflock.js',
    'dist/daemon/index.js',
    'dist/daemon/workflows/direct.roflock',
    'dist/daemon/workflows/standard.roflock',
  ];
  for (const path of required) {
    if (!files.has(path)) throw new Error(`packed artifact is missing ${path}`);
  }

  const tarball = join(packDirectory, packed.filename);
  run(npm, ['install', '--no-audit', '--no-fund', '--prefix', installDirectory, tarball], {
    cwd: scratch,
  });
  const installedRoot = join(installDirectory, 'node_modules', 'roflock');
  const entry = join(installedRoot, 'dist', 'bin', 'roflock.js');
  const shim = join(
    installDirectory,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'roflock.cmd' : 'roflock',
  );
  if (!existsSync(entry) || !existsSync(shim)) throw new Error('npm did not install the CLI entry');

  const version = run(process.execPath, [entry, '--version'], { cwd: scratch }).trim();
  if (version !== manifest.version) {
    throw new Error(`installed version ${version} does not match manifest ${manifest.version}`);
  }
  const help = run(process.execPath, [entry, '--help'], { cwd: scratch });
  if (!help.includes('roflock <command>')) throw new Error('installed help output is incomplete');

  const workflow = join(scratch, 'smoke.roflock');
  writeFileSync(
    workflow,
    `workflow smoke { version "1.0.0" max_cost 1 }\nrole writer { write }\nagent write { role writer objective "Write" }\ncheck test { run "node --version" required }\nhuman accept { title "Accept" decisions approve, reject }\nflow { write -> test test.pass -> accept test.fail -> write { max 2 } }\n`,
  );
  const checked = run(process.execPath, [entry, 'check', workflow], { cwd: scratch });
  if (!checked.includes('ok')) throw new Error('installed compiler did not accept smoke workflow');

  const initialized = JSON.parse(
    run(process.execPath, [entry, 'init', '--json', '--dir', fixtureDirectory], { cwd: scratch }),
  );
  if (initialized.created?.length !== 4)
    throw new Error('installed init did not create four files');

  process.stdout.write(
    `${JSON.stringify({
      package: `${manifest.name}@${version}`,
      tarballBytes: packed.size,
      unpackedBytes: packed.unpackedSize,
      entries: packed.entryCount,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      checks: ['manifest', 'pack-contents', 'install', 'version', 'help', 'check', 'init'],
    })}\n`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
