import { relative, resolve } from 'node:path';
import type { InvocationEvent } from '@roleflock/contracts';
import { whichBinary, type InvocationRequest, type ProviderAdapter, type ProviderCapabilities, type ProviderHealth, type PermissionEnvelope } from '@roleflock/provider-core';

export async function discoverCursor(binary?: string): Promise<Pick<ProviderHealth, 'binary' | 'version' | 'status'>> {
  const candidates = binary ? [binary] : process.env.CURSOR_PATH ? [process.env.CURSOR_PATH] : ['cursor', 'agent'];
  for (const candidate of candidates) {
    const resolved = await whichBinary(candidate);
    if (resolved) return { status: 'ready', binary: resolved };
  }
  return { status: 'missing' };
}

export interface CursorWriter { write(path: string, content: string): Promise<void>; invoke?(prompt: string, signal?: AbortSignal): AsyncIterable<string>; }
export class CursorWriterAdapter implements ProviderAdapter {
  readonly id = 'cursor'; readonly capabilities: ProviderCapabilities = { streaming: true, tools: false, writes: true, headless: false };
  constructor(
    private readonly writer: CursorWriter = { write: async () => { throw new Error('Cursor writer is not configured.'); } },
    private readonly binary = process.env.CURSOR_PATH,
  ) {}
  private assertEnvelope(envelope: PermissionEnvelope | undefined) { if (!envelope?.worktree) throw new Error('Cursor writer requires a worktree permission envelope'); return envelope; }
  async healthCheck(): Promise<ProviderHealth> {
    const discovery = await discoverCursor(this.binary);
    return discovery.status === 'ready'
      ? discovery
      : { ...discovery, detail: 'Cursor Agent CLI was not found on PATH.' };
  }
  async detectCapabilities(): Promise<ProviderCapabilities> { return this.capabilities; }
  async write(path: string, content: string, envelope: PermissionEnvelope): Promise<void> {
    const destination = resolve(envelope.worktree, path); const relativePath = relative(envelope.worktree, destination);
    if (relativePath.startsWith('..') || !envelope.allowedPaths.some((allowed) => relativePath === allowed || relativePath.startsWith(`${allowed}/`))) throw new Error(`Write denied: ${path}`);
    await this.writer.write(destination, content);
  }
  async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
    const health = await this.healthCheck();
    if (health.status === 'missing') throw new Error('Cursor Agent CLI is not installed or not available on PATH.');
    this.assertEnvelope(request.permissionEnvelope); yield { type: 'invocation.started', invocationId: request.invocationId };
    if (this.writer.invoke) for await (const text of this.writer.invoke(request.prompt, request.signal)) yield { type: 'model.output.delta', text };
    yield { type: 'invocation.completed', output: '' };
  }
}
