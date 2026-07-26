import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
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

export async function discoverCursor(
  binary?: string,
): Promise<Pick<ProviderHealth, 'binary' | 'version' | 'status'>> {
  const candidates = binary
    ? [binary]
    : process.env.CURSOR_PATH
      ? [process.env.CURSOR_PATH]
      : ['cursor', 'agent'];
  for (const candidate of candidates) {
    const resolved = await whichBinary(candidate);
    if (resolved) return { status: 'ready', binary: resolved };
  }
  return { status: 'missing' };
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

export function assertPathAllowed(envelope: PermissionEnvelope, path: string): string {
  const destination = resolve(envelope.worktree, path);
  const relativePath = relative(envelope.worktree, destination);
  if (
    relativePath.startsWith('..') ||
    !envelope.allowedPaths.some(
      (allowed) => relativePath === allowed || relativePath.startsWith(`${allowed}/`),
    )
  ) {
    throw new Error(`Write denied: ${path}`);
  }
  return destination;
}

/**
 * Cursor writer adapter. Security is enforced outside the model via the
 * permission envelope; the default path is a leased filesystem write.
 */
export class CursorWriterAdapter implements ProviderAdapter {
  readonly id = 'cursor';
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    tools: false,
    writes: true,
    headless: false,
  };

  constructor(
    private readonly writer: CursorWriter = createFsCursorWriter(),
    private readonly binary = process.env.CURSOR_PATH,
  ) {}

  private assertEnvelope(envelope: PermissionEnvelope | undefined): PermissionEnvelope {
    if (!envelope?.worktree) {
      throw new Error('Cursor writer requires a worktree permission envelope');
    }
    return envelope;
  }

  async healthCheck(): Promise<ProviderHealth> {
    const discovery = await discoverCursor(this.binary);
    if (discovery.status === 'ready') return discovery;
    return {
      status: 'ready',
      detail:
        'Sandboxed filesystem writer ready; Cursor Agent CLI was not found on PATH.',
    };
  }

  async detectCapabilities(): Promise<ProviderCapabilities> {
    return this.capabilities;
  }

  async listModels(): Promise<ProviderModel[]> {
    return [{ id: 'cursor-agent', displayName: 'Cursor Agent' }];
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

    // Without a streaming agent hook, perform the leased write described by the envelope.
    const target = envelope.allowedPaths[0];
    if (!target) {
      yield {
        type: 'invocation.failed',
        error: {
          code: 'CURSOR_ENVELOPE',
          message: 'Permission envelope has no allowedPaths',
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
      text: `Wrote ${target} under worktree lease`,
    };
    yield { type: 'invocation.completed', output: { written: target } };
  }
}
