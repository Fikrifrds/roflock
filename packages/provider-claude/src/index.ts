import { spawn } from 'node:child_process';
import type { InvocationEvent } from '@roleflock/contracts';
import {
  clampEffort,
  classifyProviderFailure,
  whichBinary,
  type InvocationRequest,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderModel,
} from '@roleflock/provider-core';

export async function discoverClaude(
  binary = process.env.CLAUDE_PATH ?? 'claude',
): Promise<Pick<ProviderHealth, 'binary' | 'version' | 'status'>> {
  const resolved = await whichBinary(binary);
  return resolved ? { status: 'ready', binary: resolved } : { status: 'missing' };
}

/** Read-only / plan-mode Claude Code adapter for planner and similar roles. */
export class ClaudeAdapter implements ProviderAdapter {
  readonly id = 'claude';
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    tools: false,
    writes: false,
    headless: true,
  };

  constructor(private readonly binary = process.env.CLAUDE_PATH ?? 'claude') {}

  async healthCheck(): Promise<ProviderHealth> {
    const discovery = await discoverClaude(this.binary);
    return discovery.status === 'ready'
      ? discovery
      : { ...discovery, detail: 'Claude CLI was not found on PATH.' };
  }

  async detectCapabilities(): Promise<ProviderCapabilities> {
    return this.capabilities;
  }

  /**
   * The Claude CLI has no `--list-models`, so this is the alias set its help
   * documents plus the account default. Effort is a separate `--effort` flag
   * here, which is why these ids carry no effort suffix.
   */
  async listModels(): Promise<ProviderModel[]> {
    return [
      { id: 'default', displayName: 'Account default', family: 'default' },
      { id: 'opus', displayName: 'Opus (latest)', family: 'opus' },
      { id: 'sonnet', displayName: 'Sonnet (latest)', family: 'sonnet' },
      { id: 'haiku', displayName: 'Haiku (latest)', family: 'haiku' },
      { id: 'fable', displayName: 'Fable (latest)', family: 'fable' },
    ];
  }

  async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
    const health = await this.healthCheck();
    if (health.status === 'missing') {
      throw new Error('Claude CLI is not installed or not available on PATH.');
    }
    yield { type: 'invocation.started', invocationId: request.invocationId };
    yield { type: 'heartbeat', at: new Date().toISOString() };

    const permissionMode = process.env.CLAUDE_PERMISSION_MODE ?? 'plan';
    const args = ['-p', request.prompt, '--output-format', 'stream-json', '--permission-mode', permissionMode];
    // `default` means "whatever the account is set to", so it is deliberately
    // not forwarded — passing it would make the CLI look for a model by that name.
    if (request.model && request.model !== 'default') args.push('--model', request.model);
    // The Claude CLI documents low…max; `ultra` exists elsewhere and would be
    // rejected here, so it is clamped rather than forwarded.
    if (request.effort) args.push('--effort', clampEffort(request.effort, 'max'));

    const child = spawn(health.binary!, args, { cwd: request.cwd, signal: request.signal });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr += d;
    });

    for await (const chunk of child.stdout) {
      yield { type: 'heartbeat', at: new Date().toISOString() };
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        try {
          const json = JSON.parse(line) as Record<string, unknown>;
          const text = json.delta ?? json.text ?? json.result;
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
        code: `CLAUDE_${kind.toUpperCase()}`,
        message: stderr || `exit ${code}`,
        retryable: kind === 'transient' || kind === 'unknown',
      },
    };
  }
}
