import { describe, expect, it } from 'vitest';
import { discoverClaude } from './index.js';

describe('discoverClaude', () => {
  it('reports a missing binary without treating its command name as installed', async () => {
    await expect(discoverClaude('roleflock-command-that-does-not-exist')).resolves.toEqual({
      status: 'missing',
    });
  });
});
