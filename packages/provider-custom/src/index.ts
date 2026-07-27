import type { InvocationEvent } from '@roleflock/contracts';
import { classifyProviderFailure } from '@roleflock/provider-core';
import type {
  InvocationRequest,
  ProviderAdapter,
  ProviderCapabilities,
  ProviderHealth,
  ProviderModel,
} from '@roleflock/provider-core';

export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    tools: false,
    writes: false,
    patches: true,
    headless: true,
  };

  constructor(
    public readonly id: string,
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.endpoint) return { status: 'missing', detail: 'No endpoint configured' };
    return {
      status: 'ready',
      detail: 'OpenAI-compatible endpoint configured (live probe deferred)',
    };
  }

  async detectCapabilities(): Promise<ProviderCapabilities> {
    return this.capabilities;
  }

  async listModels(): Promise<ProviderModel[]> {
    return [{ id: this.model, displayName: this.model }];
  }

  async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
    yield { type: 'invocation.started', invocationId: request.invocationId };
    const response = await this.fetcher(`${this.endpoint.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: request.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model || this.model,
        stream: true,
        ...(request.effort && request.effort !== 'none'
          ? { reasoning_effort: request.effort }
          : {}),
        messages: [{ role: 'user', content: request.prompt }],
      }),
    });
    if (!response.ok || !response.body) {
      // The status alone cannot tell quota from a bad key, so classify the body
      // too — a 429 and a "quota exceeded" 403 must route the same way.
      const detail = await response.text().catch(() => '');
      const kind = classifyProviderFailure(`${response.status} ${detail}`);
      yield {
        type: 'invocation.failed',
        error: {
          code: `HTTP_${kind.toUpperCase()}`,
          message: detail ? `${response.status}: ${detail.slice(0, 400)}` : `${response.status}`,
          retryable: kind === 'transient',
        },
      };
      return;
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        buffer += item.value;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') {
            yield { type: 'invocation.completed', output: '' };
            return;
          }
          try {
            const delta = JSON.parse(data).choices?.[0]?.delta;
            const reasoning = delta?.reasoning_content ?? delta?.reasoning;
            if (typeof reasoning === 'string' && reasoning) {
              yield { type: 'model.reasoning.delta', text: reasoning };
            }
            if (typeof delta?.content === 'string' && delta.content) {
              yield { type: 'model.output.delta', text: delta.content };
            }
          } catch {
            /* ignore malformed SSE frame */
          }
        }
      }
    } catch (error) {
      yield {
        type: 'invocation.interrupted',
        reason: request.signal?.aborted ? 'aborted' : String(error),
      };
    }
    yield { type: 'invocation.completed', output: '' };
  }
}
