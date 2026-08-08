import { describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleAdapter } from './index.js';

describe('OpenAiCompatibleAdapter streaming', () => {
  it('keeps reasoning progress separate from deliverable output', async () => {
    const frames = [
      'data: {"choices":[{"delta":{"reasoning_content":"checking files"}}]}\n',
      'data: {"choices":[{"delta":{"content":"diff --git a/a b/a"}}]}\n',
      'data: [DONE]\n',
    ].join('\n');
    const fetcher = vi.fn(
      async () =>
        new Response(frames, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    const adapter = new OpenAiCompatibleAdapter(
      'qwen',
      'https://example.test/v1',
      'secret',
      'qwen',
      fetcher as typeof fetch,
    );

    const events = [];
    for await (const event of adapter.invoke({
      invocationId: 'invocation',
      prompt: 'make a patch',
    })) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: 'model.reasoning.delta',
      text: 'checking files',
    });
    expect(events).toContainEqual({
      type: 'model.output.delta',
      text: 'diff --git a/a b/a',
    });
    expect(events.filter((event) => event.type === 'model.output.delta')).toHaveLength(1);
  });
});
