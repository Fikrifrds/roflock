import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';

// The daemon uses 127.0.0.1. `localhost` is a distinct browser host origin,
// while still resolving strictly to loopback, so previewed code cannot receive
// the daemon's host-only session cookie.
const PREVIEW_HOST = 'localhost';
const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

export type ReviewApp = {
  available: boolean;
  mode?: 'static' | 'run';
  state?: 'ready' | 'starting' | 'running' | 'stopped' | 'failed';
  url?: string;
  command?: string;
  detail?: string;
};

type PreviewHandle = {
  root: string;
  mode: 'static' | 'run';
  url: string;
  server?: Server;
  process?: ChildProcess;
  state: ReviewApp['state'];
  detail?: string;
};

function packageManager(root: string): 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function scriptArgs(manager: 'pnpm' | 'yarn' | 'npm', script: string, port: number): string[] {
  const flags = ['--host', PREVIEW_HOST, '--port', String(port)];
  if (manager === 'npm') return ['run', script, '--', ...flags];
  return ['run', script, '--', ...flags];
}

function serialize(handle: PreviewHandle): ReviewApp {
  return {
    available: true,
    mode: handle.mode,
    state: handle.state,
    url: handle.url,
    detail: handle.detail,
  };
}

async function reservePort(): Promise<{ port: number; release: () => Promise<void> }> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, PREVIEW_HOST, () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to reserve preview port');
  return {
    port: address.port,
    release: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}

/** User-initiated local app previews. They deliberately bind to localhost,
 * rather than RoleFlock's 127.0.0.1 origin, so reviewed code cannot inherit the
 * RoleFlock browser session or call its local API as the user. */
export class ReviewAppService {
  private readonly previews = new Map<string, PreviewHandle>();

  inspect(taskId: string, root: string): ReviewApp {
    const active = this.previews.get(taskId);
    if (active && active.root === root) return serialize(active);

    const manifest = join(root, 'package.json');
    if (existsSync(manifest)) {
      try {
        const scripts = JSON.parse(readFileSync(manifest, 'utf8')).scripts as Record<string, string> | undefined;
        const script = scripts?.dev ? 'dev' : scripts?.start ? 'start' : undefined;
        if (script) {
          const manager = packageManager(root);
          return {
            available: true,
            mode: 'run',
            state: 'ready',
            command: `${manager} run ${script}`,
            detail: 'Start a local development preview when you are ready to review it.',
          };
        }
      } catch {
        // A malformed manifest is not a reason to hide a possible static preview.
      }
    }
    if (existsSync(join(root, 'index.html')))
      return { available: true, mode: 'static', state: 'ready', detail: 'Open the static result in an isolated preview.' };
    return { available: false, detail: 'No runnable app or static entry file was detected in this task.' };
  }

  async start(taskId: string, root: string): Promise<ReviewApp> {
    const active = this.previews.get(taskId);
    if (active && active.root === root && active.state !== 'stopped' && active.state !== 'failed')
      return serialize(active);

    const candidate = this.inspect(taskId, root);
    if (!candidate.available || !candidate.mode) return candidate;
    if (candidate.mode === 'static') return this.startStatic(taskId, root);
    return this.startDev(taskId, root);
  }

  async stop(taskId: string): Promise<void> {
    const handle = this.previews.get(taskId);
    if (!handle) return;
    handle.process?.kill('SIGTERM');
    await new Promise<void>((resolveClose) => handle.server?.close(() => resolveClose()) ?? resolveClose());
    this.previews.delete(taskId);
  }

  async close(): Promise<void> {
    await Promise.all([...this.previews.keys()].map((taskId) => this.stop(taskId)));
  }

  private async startStatic(taskId: string, root: string): Promise<ReviewApp> {
    const server = createServer(async (request, response) => {
      const rawPath = decodeURIComponent(new URL(request.url ?? '/', 'http://preview.local').pathname);
      const requested = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
      const file = resolve(root, requested);
      if (relative(root, file).startsWith('..') || !existsSync(file)) {
        response.writeHead(404).end('Preview file not found');
        return;
      }
      try {
        response.writeHead(200, {
          'content-type': MIME_TYPES[extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        });
        response.end(await readFile(file));
      } catch {
        response.writeHead(500).end('Unable to read preview file');
      }
    });
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, PREVIEW_HOST, () => resolveListen());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Unable to start static preview');
    const handle: PreviewHandle = {
      root,
      mode: 'static',
      state: 'running',
      url: `http://${PREVIEW_HOST}:${address.port}/`,
      server,
      detail: 'Static preview is running in an isolated local origin.',
    };
    this.previews.set(taskId, handle);
    return serialize(handle);
  }

  private async startDev(taskId: string, root: string): Promise<ReviewApp> {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    const script = manifest.scripts?.dev ? 'dev' : 'start';
    const manager = packageManager(root);
    const reservation = await reservePort();
    const url = `http://${PREVIEW_HOST}:${reservation.port}/`;
    const child = spawn(manager, scriptArgs(manager, script, reservation.port), {
      cwd: root,
      detached: false,
      env: { ...process.env, BROWSER: 'none' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const handle: PreviewHandle = {
      root,
      mode: 'run',
      state: 'starting',
      url,
      process: child,
      detail: `Starting ${manager} run ${script} on an isolated local origin…`,
    };
    this.previews.set(taskId, handle);
    await reservation.release();
    let output = '';
    const capture = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-2_000);
      if (handle.state === 'starting') {
        handle.state = 'running';
        handle.detail = `Preview running: ${basename(root)} (${manager} run ${script}).`;
      }
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    child.once('error', (error) => {
      handle.state = 'failed';
      handle.detail = `Could not start preview: ${error.message}`;
    });
    child.once('exit', (code) => {
      handle.state = code === 0 ? 'stopped' : 'failed';
      handle.detail = output ? `Preview stopped: ${output.trim().slice(-500)}` : 'Preview process stopped.';
    });
    return serialize(handle);
  }
}
