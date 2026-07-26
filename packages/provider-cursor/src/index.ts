import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { InvocationEvent } from '@roleflock/contracts';
import {
  whichBinary,
  type InvocationRequest,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderModel,
  type PermissionEnvelope,
} from '@roleflock/provider-core';

const execFileAsync = promisify(execFile);

async function resolveCandidate(candidate: string): Promise<string | undefined> {
  if (isAbsolute(candidate)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      return undefined;
    }
  }
  return whichBinary(candidate);
}

export interface CursorWriter {
  write(path: string, content: string): Promise<void>;
  invoke?(prompt: string, signal?: AbortSignal): AsyncIterable<string>;
}

/** Filesystem-backed writer used under RoleFlock's permission envelope. */
export function createFsCursorWriter(): CursorWriter {
  return {
    write: async (path, content) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
    },
  };
}

function isWholeTreeAllow(allowedPaths: string[]): boolean {
  return allowedPaths.includes('**') || allowedPaths.includes('*');
}

export function assertPathAllowed(envelope: PermissionEnvelope, path: string): string {
  const destination = resolve(envelope.worktree, path);
  const relativePath = relative(envelope.worktree, destination);
  if (relativePath.startsWith('..') || relativePath === '') {
    throw new Error(`Write denied: ${path}`);
  }
  if (isWholeTreeAllow(envelope.allowedPaths)) {
    return destination;
  }
  if (
    !envelope.allowedPaths.some(
      (allowed) => relativePath === allowed || relativePath.startsWith(`${allowed}/`),
    )
  ) {
    throw new Error(`Write denied: ${path}`);
  }
  return destination;
}

/** Reject agent/tool writes that escaped the permission envelope. */
export function assertChangedPathsAllowed(
  envelope: PermissionEnvelope,
  changedFiles: string[],
): void {
  for (const file of changedFiles) {
    const normalized = file.includes(' -> ') ? file.split(' -> ').pop()!.trim() : file.trim();
    if (!normalized || normalized === '.') continue;
    assertPathAllowed(envelope, normalized);
  }
}

const INSTALL_HINT = 'Install with: curl https://cursor.com/install -fsS | bash';

/** Other vendors also ship a bare `agent` binary; never mistake one for Cursor. */
function isForeignAgent(binary: string): boolean {
  return /[\\/]\.(grok|gemini|qwen)[\\/]/.test(binary);
}

async function looksLikeCursorAgent(binary: string): Promise<boolean> {
  if (isForeignAgent(binary)) return false;
  try {
    const { stdout, stderr } = await execFileAsync(binary, ['--help'], {
      timeout: 8_000,
      env: process.env,
    });
    const text = `${stdout}\n${stderr}`;
    if (/\bgrok\b|\bxai\b/i.test(text)) return false;
    return (
      /--print\b/.test(text) &&
      (/--force\b/.test(text) || /--yolo\b/.test(text) || /cursor/i.test(text))
    );
  } catch {
    return false;
  }
}

/**
 * Discover the Cursor Agent CLI (`agent` / `cursor-agent`), never another vendor's `agent`.
 *
 * An explicitly configured binary — the `binary` argument, `CURSOR_AGENT_PATH`, or
 * `CURSOR_PATH` — is authoritative: if it is missing or is not the Cursor Agent CLI the
 * result is `missing`. Falling back to PATH there would silently run a different binary
 * than the one the operator configured.
 */
export async function discoverCursor(
  binary?: string,
): Promise<Pick<ProviderHealth, 'binary' | 'version' | 'status' | 'detail'>> {
  const configured = binary ?? process.env.CURSOR_AGENT_PATH ?? process.env.CURSOR_PATH;

  if (configured) {
    const resolved = await resolveCandidate(configured);
    if (!resolved) {
      return { status: 'missing', detail: `Configured Cursor binary not found: ${configured}` };
    }
    if (!(await looksLikeCursorAgent(resolved))) {
      return {
        status: 'missing',
        detail: `Configured binary is not the Cursor Agent CLI: ${resolved}`,
      };
    }
    return { status: 'ready', binary: resolved };
  }

  for (const candidate of ['cursor-agent', 'agent']) {
    const resolved = await resolveCandidate(candidate);
    if (!resolved) continue;
    if (!(await looksLikeCursorAgent(resolved))) continue;
    return { status: 'ready', binary: resolved };
  }

  return {
    status: 'missing',
    detail: `Cursor Agent CLI was not found on PATH. ${INSTALL_HINT}`,
  };
}

function extractStreamText(line: string): string | undefined {
  try {
    const json = JSON.parse(line) as Record<string, unknown>;
    if (json.type === 'assistant' && json.message && typeof json.message === 'object') {
      const message = json.message as { content?: Array<{ text?: string }> };
      const text = (message.content ?? [])
        .map((part) => part.text)
        .filter((value): value is string => Boolean(value))
        .join('');
      return text || undefined;
    }
    if (typeof json.result === 'string') return json.result;
    if (typeof json.text === 'string') return json.text;
    if (typeof json.delta === 'string') return json.delta;
    return undefined;
  } catch {
    return line;
  }
}

/**
 * Cursor writer adapter. Prefer live Cursor Agent CLI when installed; otherwise
 * fall back to a leased filesystem write under the permission envelope.
 */
export class CursorWriterAdapter implements ProviderAdapter {
  readonly id = 'cursor';
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    writes: true,
    headless: true,
  };

  constructor(
    private readonly writer: CursorWriter = createFsCursorWriter(),
    private readonly binaryHint = process.env.CURSOR_AGENT_PATH ?? process.env.CURSOR_PATH,
  ) {}

  private assertEnvelope(envelope: PermissionEnvelope | undefined): PermissionEnvelope {
    if (!envelope?.worktree) {
      throw new Error('Cursor writer requires a worktree permission envelope');
    }
    return envelope;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const discovery = await discoverCursor(this.binaryHint);
    if (discovery.status === 'ready') {
      return {
        ...discovery,
        detail: `Cursor Agent CLI ready (${discovery.binary})`,
      };
    }
    return {
      status: 'ready',
      detail:
        discovery.detail ??
        'Sandboxed filesystem writer ready; Cursor Agent CLI was not found on PATH.',
    };
  }

  async detectCapabilities(): Promise<ProviderCapabilities> {
    const discovery = await discoverCursor(this.binaryHint);
    return {
      ...this.capabilities,
      tools: discovery.status === 'ready',
      headless: discovery.status === 'ready',
    };
  }

  async listModels(): Promise<ProviderModel[]> {
    return [{ id: 'cursor-agent', displayName: 'Cursor Agent' }];
  }

  async hasAgentCli(): Promise<boolean> {
    const discovery = await discoverCursor(this.binaryHint);
    return discovery.status === 'ready';
  }

  async write(path: string, content: string, envelope: PermissionEnvelope): Promise<void> {
    const destination = assertPathAllowed(envelope, path);
    await this.writer.write(destination, content);
  }

  async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
    const envelope = this.assertEnvelope(request.permissionEnvelope);
    yield { type: 'invocation.started', invocationId: request.invocationId };
    yield { type: 'heartbeat', at: new Date().toISOString() };

    if (this.writer.invoke) {
      for await (const text of this.writer.invoke(request.prompt, request.signal)) {
        yield { type: 'model.output.delta', text };
      }
      yield { type: 'invocation.completed', output: '' };
      return;
    }

    const forceFs =
      process.env.ROLEFLOCK_CURSOR_AGENT === '0' || process.env.ROLEFLOCK_FORCE_FAKE === '1';
    const discovery = forceFs
      ? { status: 'missing' as const }
      : await discoverCursor(this.binaryHint);

    if (discovery.status === 'ready' && discovery.binary) {
      const args = [
        '-p',
        '--force',
        '--trust',
        '--workspace',
        envelope.worktree,
        '--output-format',
        'stream-json',
      ];
      if (envelope.allowCommands === false) {
        args.push('--sandbox', 'enabled');
      }
      args.push(request.prompt);

      const child = spawn(discovery.binary, args, {
        cwd: request.cwd ?? envelope.worktree,
        signal: request.signal,
        env: process.env,
      });
      let stderr = '';
      child.stderr.on('data', (d: Buffer) => {
        stderr += d;
      });

      for await (const chunk of child.stdout) {
        yield { type: 'heartbeat', at: new Date().toISOString() };
        for (const line of String(chunk).split('\n').filter(Boolean)) {
          const text = extractStreamText(line);
          if (text) yield { type: 'model.output.delta', text };
        }
      }

      const code: number = await new Promise((resolve) =>
        child.on('close', (value) => resolve(value ?? 1)),
      );
      if (code !== 0) {
        yield {
          type: 'invocation.failed',
          error: {
            code: 'CURSOR_AGENT_EXIT',
            message: stderr || `Cursor Agent exit ${code}`,
            retryable: true,
          },
        };
        return;
      }
      yield { type: 'invocation.completed', output: { mode: 'cursor-agent' } };
      return;
    }

    // Without Agent CLI, perform the leased write described by the envelope.
    const target = envelope.allowedPaths.find((path) => path !== '**' && path !== '*');
    if (!target) {
      yield {
        type: 'invocation.failed',
        error: {
          code: 'CURSOR_ENVELOPE',
          message:
            'Cursor Agent CLI missing and permission envelope has no concrete allowedPaths for fallback write',
          retryable: false,
        },
      };
      return;
    }
    await this.write(
      target,
      typeof request.prompt === 'string' ? request.prompt : String(request.prompt),
      envelope,
    );
    yield {
      type: 'model.output.delta',
      text: `Wrote ${target} under worktree lease (Cursor Agent CLI not available)`,
    };
    yield { type: 'invocation.completed', output: { written: target, mode: 'fs-fallback' } };
  }
}
