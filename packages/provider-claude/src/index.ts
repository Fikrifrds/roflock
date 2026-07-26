import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { InvocationEvent } from '@roleflock/contracts';
import type { InvocationRequest, ProviderAdapter, ProviderCapabilities } from '@roleflock/provider-core';
export async function discoverClaude(binary = process.env.CLAUDE_PATH ?? 'claude'): Promise<string | undefined> { try { await access(binary); return binary; } catch { return binary.includes('/') ? undefined : binary; } }
export class ClaudeAdapter implements ProviderAdapter {
  readonly id = 'claude'; readonly capabilities: ProviderCapabilities = { streaming: true, tools: false, writes: false, headless: true };
  constructor(private readonly binary = process.env.CLAUDE_PATH ?? 'claude') {}
  async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
    yield { type: 'invocation.started', invocationId: request.invocationId };
    const child = spawn(this.binary, ['-p', request.prompt, '--output-format', 'stream-json'], { cwd: request.cwd, signal: request.signal });
    let stderr = ''; child.stderr.on('data', (d: Buffer) => { stderr += d; });
    for await (const chunk of child.stdout) { for (const line of String(chunk).split('\n').filter(Boolean)) { try { const json = JSON.parse(line); const text = json.delta ?? json.text ?? json.result; if (typeof text === 'string') yield { type: 'model.output.delta', text }; } catch { yield { type: 'model.output.delta', text: line }; } } }
    const code: number = await new Promise((resolve) => child.on('close', (value) => resolve(value ?? 1)));
    yield code === 0 ? { type: 'invocation.completed', output: '' } : { type: 'invocation.failed', error: { code: 'CLAUDE_EXIT', message: stderr || `exit ${code}` } };
  }
}
