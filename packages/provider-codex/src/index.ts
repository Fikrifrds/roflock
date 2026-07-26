import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { InvocationEvent } from '@roleflock/contracts';
import type { InvocationRequest, ProviderAdapter, ProviderCapabilities } from '@roleflock/provider-core';
export async function discoverCodex(binary = process.env.CODEX_PATH ?? 'codex'): Promise<string | undefined> { try { await access(binary); return binary; } catch { return binary.includes('/') ? undefined : binary; } }
export class CodexAdapter implements ProviderAdapter {
  readonly id = 'codex'; readonly capabilities: ProviderCapabilities = { streaming: true, tools: false, writes: false, headless: true };
  constructor(private readonly binary = process.env.CODEX_PATH ?? 'codex') {}
  async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
    yield { type: 'invocation.started', invocationId: request.invocationId };
    const child = spawn(this.binary, ['exec', '--json', request.prompt], { cwd: request.cwd, signal: request.signal });
    let stderr = ''; child.stderr.on('data', (d: Buffer) => { stderr += d; });
    for await (const chunk of child.stdout) for (const line of String(chunk).split('\n').filter(Boolean)) { try { const event = JSON.parse(line); const text = event.delta ?? event.message ?? event.text; if (typeof text === 'string') yield { type: 'model.output.delta', text }; } catch { yield { type: 'model.output.delta', text: line }; } }
    const code: number = await new Promise((resolve) => child.on('close', (value) => resolve(value ?? 1)));
    yield code === 0 ? { type: 'invocation.completed', output: '' } : { type: 'invocation.failed', error: { code: 'CODEX_EXIT', message: stderr || `exit ${code}` } };
  }
}
