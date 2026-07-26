import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { InvocationEvent } from '@roleflock/contracts';

const execFileAsync = promisify(execFile);

export interface ProviderCapabilities { streaming: boolean; tools: boolean; writes: boolean; headless: boolean; }
export interface ProviderHealth {
  status: 'ready' | 'missing' | 'unauthenticated' | 'error';
  detail?: string;
  binary?: string;
  version?: string;
}
export interface ProviderModel { id: string; displayName: string; }
export interface InvocationRequest { invocationId: string; prompt: string; cwd?: string; signal?: AbortSignal; permissionEnvelope?: PermissionEnvelope; }
export interface PermissionEnvelope { worktree: string; allowedPaths: string[]; allowCommands?: boolean; }
export interface ProviderAdapter {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  invoke(request: InvocationRequest): AsyncIterable<InvocationEvent>;
  healthCheck?(): Promise<ProviderHealth>;
  detectCapabilities?(): Promise<ProviderCapabilities>;
  listModels?(): Promise<ProviderModel[]>;
}

/** Resolves a command from PATH without assuming a bare command name exists. */
export async function whichBinary(name: string): Promise<string | undefined> {
  const command = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(command, [name]);
    return stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();
  register(adapter: ProviderAdapter) { if (this.adapters.has(adapter.id)) throw new Error(`Provider already registered: ${adapter.id}`); this.adapters.set(adapter.id, adapter); }
  get(id: string) { const adapter = this.adapters.get(id); if (!adapter) throw new Error(`Provider not found: ${id}`); return adapter; }
  list() { return [...this.adapters.values()]; }
}
export class FakeProvider implements ProviderAdapter {
  readonly capabilities: ProviderCapabilities = { streaming: true, tools: true, writes: false, headless: true };
  constructor(public readonly id = 'fake', private readonly events: InvocationEvent[] = []) {}
  async healthCheck(): Promise<ProviderHealth> { return { status: 'ready' }; }
  async detectCapabilities(): Promise<ProviderCapabilities> { return this.capabilities; }
  async listModels(): Promise<ProviderModel[]> { return [{ id: 'phase0-fake', displayName: 'Phase 0 Fake' }]; }
  async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
    yield { type: 'invocation.started', invocationId: request.invocationId };
    for (const event of this.events) { if (request.signal?.aborted) { yield { type: 'invocation.interrupted', reason: 'aborted' }; return; } yield event; }
    if (!this.events.some((e) => e.type === 'invocation.completed' || e.type === 'invocation.failed')) yield { type: 'invocation.completed', output: '' };
  }
}
