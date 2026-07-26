import { spawn } from 'node:child_process';
import type { InvocationEvent } from '@roleflock/contracts';
import {
  whichBinary,
  type InvocationRequest,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderModel,
} from '@roleflock/provider-core';

export async function discoverCodex(
  binary = process.env.CODEX_PATH ?? 'codex',
): Promise<Pick<ProviderHealth, 'binary' | 'version' | 'status'>> {
  const resolved = await whichBinary(binary);
  return resolved ? { status: 'ready', binary: resolved } : { status: 'missing' };
}

/** Read-oriented Codex adapter used for verifier turns. */
export class CodexAdapter implements ProviderAdapter {
  readonly id = 'codex';
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    tools: false,
    writes: false,
    headless: true,
  };

  constructor(private readonly binary = process.env.CODEX_PATH ?? 'codex') {}

  async healthCheck(): Promise<ProviderHealth> {
    const discovery = await discoverCodex(this.binary);
    return discovery.status === 'ready'
      ? discovery
      : { ...discovery, detail: 'Codex CLI was not found on PATH.' };
  }

  async detectCapabilities(): Promise<ProviderCapabilities> {
    return this.capabilities;
  }

  async listModels(): Promise<ProviderModel[]> {
    return [{ id: 'codex', displayName: 'Codex' }];
  }

  async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
    const health = await this.healthCheck();
    if (health.status === 'missing') {
      throw new Error('Codex CLI is not installed or not available on PATH.');
    }
    yield { type: 'invocation.started', invocationId: request.invocationId };
    yield { type: 'heartbeat', at: new Date().toISOString() };

    const child = spawn(health.binary!, ['exec', '--json', request.prompt], {
      cwd: request.cwd,
      signal: request.signal,
    });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d;
    });

    for await (const chunk of child.stdout) {
      yield { type: 'heartbeat', at: new Date().toISOString() };
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          const text = event.delta ?? event.message ?? event.text;
          if (typeof text === 'string') yield { type: 'model.output.delta', text };
        } catch {
          yield { type: 'model.output.delta', text: line };
        }
      }
    }

    const code: number = await new Promise((resolve) =>
      child.on('close', (value) => resolve(value ?? 1)),
    );
    yield code === 0
      ? { type: 'invocation.completed', output: '' }
      : {
          type: 'invocation.failed',
          error: { code: 'CODEX_EXIT', message: stderr || `exit ${code}`, retryable: true },
        };
  }
}
