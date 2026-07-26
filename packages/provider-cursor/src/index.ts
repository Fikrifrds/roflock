import { relative, resolve } from 'node:path';
import type { InvocationEvent } from '@roleflock/contracts';
import type { InvocationRequest, ProviderAdapter, ProviderCapabilities, PermissionEnvelope } from '@roleflock/provider-core';
export interface CursorWriter { write(path: string, content: string): Promise<void>; invoke?(prompt: string, signal?: AbortSignal): AsyncIterable<string>; }
export class CursorWriterAdapter implements ProviderAdapter {
  readonly id = 'cursor'; readonly capabilities: ProviderCapabilities = { streaming: true, tools: false, writes: true, headless: false };
  constructor(private readonly writer: CursorWriter) {}
  private assertEnvelope(envelope: PermissionEnvelope | undefined) { if (!envelope?.worktree) throw new Error('Cursor writer requires a worktree permission envelope'); return envelope; }
  async write(path: string, content: string, envelope: PermissionEnvelope): Promise<void> {
    const destination = resolve(envelope.worktree, path); const relativePath = relative(envelope.worktree, destination);
    if (relativePath.startsWith('..') || !envelope.allowedPaths.some((allowed) => relativePath === allowed || relativePath.startsWith(`${allowed}/`))) throw new Error(`Write denied: ${path}`);
    await this.writer.write(destination, content);
  }
  async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
    this.assertEnvelope(request.permissionEnvelope); yield { type: 'invocation.started', invocationId: request.invocationId };
    if (this.writer.invoke) for await (const text of this.writer.invoke(request.prompt, request.signal)) yield { type: 'model.output.delta', text };
    yield { type: 'invocation.completed', output: '' };
  }
}
