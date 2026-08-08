import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'roflock-package-smoke-'));
const packDirectory = join(scratch, 'pack');
const installDirectory = join(scratch, 'install');
const fixtureDirectory = join(scratch, 'fixture');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let installedEntry;
let daemonDataDir;
let daemonBaseUrl;

function run(command, args, options = {}) {
  return runAllow(command, args, [0], options).stdout;
}

function runAllow(command, args, allowedStatuses, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
    env: { ...process.env, CI: 'true', ...(options.env ?? {}) },
  });
  if (!allowedStatuses.includes(result.status)) {
    throw new Error(
      [`${command} ${args.join(' ')} failed (${result.status})`, result.stdout, result.stderr]
        .filter(Boolean)
        .join('\n'),
    );
  }
  return result;
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

async function availablePort() {
  const server = createServer();
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveReady);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : undefined;
  await new Promise((resolveClosed) => server.close(resolveClosed));
  if (!port) throw new Error('unable to reserve a package-smoke port');
  return port;
}

async function waitForRun(entry, graphRunId, expectedStates, options) {
  const deadline = Date.now() + 30_000;
  let latest;
  while (Date.now() < deadline) {
    const result = runAllow(
      process.execPath,
      [
        entry,
        'status',
        graphRunId,
        '--json',
        '--daemon-url',
        options.baseUrl,
        '--data-dir',
        options.dataDir,
      ],
      [0, 4, 5, 6, 7],
      { cwd: options.cwd },
    );
    latest = JSON.parse(result.stdout);
    if (expectedStates.includes(latest.state) || expectedStates.includes(latest.taskState)) {
      return latest;
    }
    await new Promise((resolveReady) => setTimeout(resolveReady, 100));
  }
  throw new Error(
    `run ${graphRunId} did not reach ${expectedStates.join('/')} within 30s: ${JSON.stringify(latest)}`,
  );
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
    'dist/bin/roflock-mcp.js',
    'dist/bin/roflock.js',
    'dist/bin/roleflock.js',
    'dist/daemon/index.js',
    'dist/daemon/web/index.html',
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
  installedEntry = entry;
  const mcpEntry = join(installedRoot, 'dist', 'bin', 'roflock-mcp.js');
  const shim = join(
    installDirectory,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'roflock.cmd' : 'roflock',
  );
  if (!existsSync(entry) || !existsSync(shim)) throw new Error('npm did not install the CLI entry');
  if (!existsSync(mcpEntry)) throw new Error('npm did not install the MCP entry');

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
  writeFileSync(join(fixtureDirectory, 'README.md'), '# Packed-artifact quickstart fixture\n');
  writeFileSync(
    join(fixtureDirectory, 'package.json'),
    JSON.stringify({ private: true, scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
  );
  run('git', ['init'], { cwd: fixtureDirectory });
  run('git', ['config', 'user.email', 'quickstart@roflock.local'], { cwd: fixtureDirectory });
  run('git', ['config', 'user.name', 'Roflock Quickstart'], { cwd: fixtureDirectory });
  run('git', ['add', '.'], { cwd: fixtureDirectory });
  run('git', ['commit', '-m', 'Initialize packed quickstart'], { cwd: fixtureDirectory });
  run(process.execPath, [join(packageRoot, 'scripts', 'mcp-smoke.mjs'), mcpEntry], {
    cwd: scratch,
  });

  const port = await availablePort();
  daemonDataDir = join(scratch, 'daemon-data');
  daemonBaseUrl = `http://127.0.0.1:${port}`;
  const studio = JSON.parse(
    run(
      process.execPath,
      [entry, 'studio', '--json', '--daemon-url', daemonBaseUrl, '--data-dir', daemonDataDir],
      { cwd: scratch, env: { ROFLOCK_FORCE_FAKE: '1' } },
    ),
  );
  if (!studio.url?.startsWith(`${daemonBaseUrl}/?rft=`)) {
    throw new Error('installed CLI did not return a Studio handoff URL');
  }
  const studioResponse = await fetch(daemonBaseUrl);
  const studioHtml = await studioResponse.text();
  if (!studioResponse.ok || !studioHtml.includes('<title>Roflock')) {
    throw new Error('installed daemon did not serve the bundled Studio');
  }
  if (studioHtml.includes('fonts.googleapis.com') || studioHtml.includes('fonts.gstatic.com')) {
    throw new Error('bundled Studio makes a remote font request');
  }

  const started = JSON.parse(
    run(
      process.execPath,
      [
        entry,
        'run',
        join(fixtureDirectory, '.roflock', 'workflows', 'bugfix.roflock'),
        '--repo',
        fixtureDirectory,
        '--brief',
        'Prove the packed artifact executes its generated workflow',
        '--json',
        '--daemon-url',
        daemonBaseUrl,
        '--data-dir',
        daemonDataDir,
      ],
      { cwd: fixtureDirectory },
    ),
  );
  if (!started.graphRunId || !started.taskId || !started.semanticHash) {
    throw new Error('installed runtime did not return stable run/task/hash identities');
  }
  const awaitingAcceptance = await waitForRun(
    entry,
    started.graphRunId,
    ['awaiting_acceptance', 'failed'],
    { cwd: fixtureDirectory, baseUrl: daemonBaseUrl, dataDir: daemonDataDir },
  );
  if (awaitingAcceptance.taskState !== 'awaiting_acceptance') {
    throw new Error(
      `packed quickstart run failed before acceptance: ${JSON.stringify(awaitingAcceptance)}`,
    );
  }
  const events = JSON.parse(
    run(
      process.execPath,
      [
        entry,
        'events',
        started.graphRunId,
        '--after',
        '0',
        '--json',
        '--daemon-url',
        daemonBaseUrl,
        '--data-dir',
        daemonDataDir,
      ],
      { cwd: fixtureDirectory },
    ),
  );
  if (!Array.isArray(events) || events.length === 0 || events[0]?.sequence !== 1) {
    throw new Error('installed runtime did not return ordered durable events');
  }
  const decision = JSON.parse(
    run(
      process.execPath,
      [
        entry,
        'accept-task',
        started.taskId,
        '--json',
        '--daemon-url',
        daemonBaseUrl,
        '--data-dir',
        daemonDataDir,
      ],
      { cwd: fixtureDirectory },
    ),
  );
  if (decision.decision !== 'accepted') {
    throw new Error('installed runtime did not persist final task acceptance');
  }
  await waitForRun(entry, started.graphRunId, ['completed'], {
    cwd: fixtureDirectory,
    baseUrl: daemonBaseUrl,
    dataDir: daemonDataDir,
  });
  run(
    process.execPath,
    [entry, 'daemon', 'stop', '--daemon-url', daemonBaseUrl, '--data-dir', daemonDataDir],
    { cwd: scratch },
  );
  daemonBaseUrl = undefined;

  process.stdout.write(
    `${JSON.stringify({
      package: `${manifest.name}@${version}`,
      tarballBytes: packed.size,
      unpackedBytes: packed.unpackedSize,
      entries: packed.entryCount,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      checks: [
        'manifest',
        'pack-contents',
        'install',
        'version',
        'help',
        'check',
        'init',
        'mcp-stdio',
        'studio-http',
        'authored-run',
        'status-events',
        'terminal-decision',
      ],
    })}\n`,
  );
} finally {
  if (daemonBaseUrl && installedEntry && daemonDataDir) {
    spawnSync(
      process.execPath,
      [
        installedEntry,
        'daemon',
        'stop',
        '--daemon-url',
        daemonBaseUrl,
        '--data-dir',
        daemonDataDir,
      ],
      { cwd: scratch, encoding: 'utf8' },
    );
  }
  rmSync(scratch, { recursive: true, force: true });
}
