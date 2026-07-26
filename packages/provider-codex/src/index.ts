import { spawn } from 'node:child_process';
import type { InvocationEvent } from '@roleflock/contracts';
import {
  classifyProviderFailure,
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

  /**
   * `codex` has no machine-readable model list, so this mirrors what its
   * interactive picker offers. Unlike Cursor, Codex takes reasoning level as a
   * separate setting, so these ids carry no effort suffix — the same model at a
   * different effort is one entry here, not two.
   *
   * `-m` forwards whatever it is given, so a model missing from this list still
   * works if typed; an account that does not have it fails as `unknown_model`
   * and the router moves to the next candidate.
   */
  async listModels(): Promise<ProviderModel[]> {
    return [
      { id: 'default', displayName: 'Account default', family: 'default' },
      { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol — frontier agentic coding', family: 'gpt-5.6-sol' },
      { id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra — balanced everyday work', family: 'gpt-5.6-terra' },
      { id: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna — fast and affordable', family: 'gpt-5.6-luna' },
      { id: 'gpt-5.5', displayName: 'GPT-5.5 — complex coding and research', family: 'gpt-5.5' },
      { id: 'gpt-5.4', displayName: 'GPT-5.4 — strong everyday coding', family: 'gpt-5.4' },
      { id: 'gpt-5.4-mini', displayName: 'GPT-5.4 mini — small and cost-efficient', family: 'gpt-5.4' },
    ];
  }

  async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
    const health = await this.healthCheck();
    if (health.status === 'missing') {
      throw new Error('Codex CLI is not installed or not available on PATH.');
    }
    yield { type: 'invocation.started', invocationId: request.invocationId };
    yield { type: 'heartbeat', at: new Date().toISOString() };

    const args = ['exec', '--json'];
    if (request.model && request.model !== 'default') args.push('-m', request.model);
    // Codex takes reasoning effort as a config override rather than a flag.
    if (request.effort) args.push('-c', `model_reasoning_effort="${request.effort}"`);
    args.push(request.prompt);

    const child = spawn(health.binary!, args, {
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
    if (code === 0) {
      yield { type: 'invocation.completed', output: '' };
      return;
    }
    const kind = classifyProviderFailure(stderr);
    yield {
      type: 'invocation.failed',
      error: {
        code: `CODEX_${kind.toUpperCase()}`,
        message: stderr || `exit ${code}`,
        retryable: kind === 'transient' || kind === 'unknown',
      },
    };
  }
}
