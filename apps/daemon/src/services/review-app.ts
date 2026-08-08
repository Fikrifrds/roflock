import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';

// The daemon uses 127.0.0.1. `localhost` is a distinct browser host origin,
// while still resolving strictly to loopback, so previewed code cannot receive
// the daemon's host-only session cookie.
const PREVIEW_HOST = 'localhost';

/** Browser module scripts reject anything that is not a JS MIME type when nosniff is on. */
const JS_MIME = 'text/javascript; charset=utf-8';

const MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.cjs': JS_MIME,
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': JS_MIME,
  '.json': 'application/json; charset=utf-8',
  '.jsx': JS_MIME,
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mjs': JS_MIME,
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ts': JS_MIME,
  '.tsx': JS_MIME,
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

/** Resolve a safe Content-Type for static preview responses. */
export function contentTypeFor(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (MIME_TYPES[ext]) return MIME_TYPES[ext]!;
  // Extensionless module-ish names still show up in some bundler outputs.
  const base = basename(filePath).toLowerCase();
  if (base.endsWith('.js') || base.endsWith('.mjs') || base.endsWith('.cjs')) return JS_MIME;
  return 'application/octet-stream';
}

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

type PreviewLaunch = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

function packageManager(root: string): 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/** `python -m http.server` is a static file server — Vite-style flags break it. */
export function isPythonHttpServerScript(script: string): boolean {
  return /^\s*(python3?|py)(?:\s+-m\s+http\.server|\s+-mhttp\.server)(?:\s+\d+)?\s*$/.test(script);
}

/**
 * Build the child process invocation for a package script.
 * Vite accepts `--host/--port`; Python's http.server wants `[port] -b host`.
 */
export function resolvePreviewLaunch(
  manager: 'pnpm' | 'yarn' | 'npm',
  scriptName: string,
  scriptBody: string,
  port: number,
): PreviewLaunch {
  const python = /^\s*(python3?|py)\s+-m\s+http\.server(?:\s+\d+)?\s*$/.exec(scriptBody);
  if (python) {
    const binary = python[1] === 'py' ? 'py' : python[1]!;
    return {
      command: binary,
      args: ['-m', 'http.server', String(port), '-b', PREVIEW_HOST],
      env: { PORT: String(port), HOST: PREVIEW_HOST },
    };
  }

  const flags = ['--host', PREVIEW_HOST, '--port', String(port)];
  return {
    command: manager,
    args: ['run', scriptName, '--', ...flags],
    env: { PORT: String(port), HOST: PREVIEW_HOST },
  };
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

    const hasIndex = existsSync(join(root, 'index.html'));
    const manifest = join(root, 'package.json');
    if (existsSync(manifest)) {
      try {
        const scripts = JSON.parse(readFileSync(manifest, 'utf8')).scripts as
          Record<string, string> | undefined;
        const script = scripts?.dev ? 'dev' : scripts?.start ? 'start' : undefined;
        if (script && scripts?.[script]) {
          // A plain python static server + index.html is better served by our
          // isolated static preview than by re-spawning http.server with the
          // wrong flags.
          if (isPythonHttpServerScript(scripts[script]) && hasIndex) {
            return {
              available: true,
              mode: 'static',
              state: 'ready',
              detail: 'Open the static result in an isolated preview.',
            };
          }
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
    if (hasIndex)
      return {
        available: true,
        mode: 'static',
        state: 'ready',
        detail: 'Open the static result in an isolated preview.',
      };
    return {
      available: false,
      detail: 'No runnable app or static entry file was detected in this task.',
    };
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
    await new Promise<void>(
      (resolveClose) => handle.server?.close(() => resolveClose()) ?? resolveClose(),
    );
    this.previews.delete(taskId);
  }

  async close(): Promise<void> {
    await Promise.all([...this.previews.keys()].map((taskId) => this.stop(taskId)));
  }

  private async startStatic(taskId: string, root: string): Promise<ReviewApp> {
    const server = createServer(async (request, response) => {
      const rawPath = decodeURIComponent(
        new URL(request.url ?? '/', 'http://preview.local').pathname,
      );
      const requested = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
      let file = resolve(root, requested);
      if (relative(root, file).startsWith('..')) {
        response.writeHead(404).end('Preview file not found');
        return;
      }
      // Directory URLs should still open an app entry when present.
      if (existsSync(file) && !extname(file)) {
        const nestedIndex = join(file, 'index.html');
        if (existsSync(nestedIndex)) file = nestedIndex;
      }
      if (!existsSync(file)) {
        response.writeHead(404).end('Preview file not found');
        return;
      }
      try {
        response.writeHead(200, {
          'content-type': contentTypeFor(file),
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
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const script = manifest.scripts?.dev ? 'dev' : 'start';
    const scriptBody = manifest.scripts?.[script] ?? script;
    const manager = packageManager(root);
    const reservation = await reservePort();
    const url = `http://${PREVIEW_HOST}:${reservation.port}/`;
    const launch = resolvePreviewLaunch(manager, script, scriptBody, reservation.port);
    const child = spawn(launch.command, launch.args, {
      cwd: root,
      detached: false,
      env: { ...process.env, BROWSER: 'none', ...launch.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const handle: PreviewHandle = {
      root,
      mode: 'run',
      state: 'starting',
      url,
      process: child,
      detail: `Starting ${launch.command} ${launch.args.join(' ')} on an isolated local origin…`,
    };
    this.previews.set(taskId, handle);
    await reservation.release();
    let output = '';
    const capture = (chunk: Buffer) => {
      output = `${output}${chunk.toString()}`.slice(-2_000);
      if (handle.state === 'starting') {
        handle.state = 'running';
        handle.detail = `Preview running: ${basename(root)} (${launch.command} ${launch.args.join(' ')}).`;
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
      handle.detail = output
        ? `Preview stopped: ${output.trim().slice(-500)}`
        : 'Preview process stopped.';
    });
    return serialize(handle);
  }
}
