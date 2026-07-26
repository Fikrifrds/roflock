import { describe, expect, it } from 'vitest';
import { FakeProvider } from './index.js';
describe('FakeProvider', () => {
  it('emits a start event, supplied events, and completion', async () => {
    const provider = new FakeProvider('fake', [{ type: 'model.output.delta', text: 'hello' }]);
    const events = []; for await (const event of provider.invoke({ invocationId: 'invocation', prompt: 'test' })) events.push(event);
    expect(events).toEqual([{ type: 'invocation.started', invocationId: 'invocation' }, { type: 'model.output.delta', text: 'hello' }, { type: 'invocation.completed', output: '' }]);
  });
});
