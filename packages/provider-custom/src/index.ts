import type { InvocationEvent } from '@roleflock/contracts';
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
        model: this.model,
        stream: true,
        messages: [{ role: 'user', content: request.prompt }],
      }),
    });
    if (!response.ok || !response.body) {
      yield {
        type: 'invocation.failed',
        error: {
          code: 'HTTP_ERROR',
          message: `${response.status}`,
          retryable: response.status >= 500,
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
            const delta = JSON.parse(data).choices?.[0]?.delta?.content;
            if (typeof delta === 'string') yield { type: 'model.output.delta', text: delta };
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
