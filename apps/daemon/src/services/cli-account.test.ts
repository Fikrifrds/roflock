import { describe, expect, it } from 'vitest';
import { parseOpenCodeAuthList } from './cli-account.js';

describe('OpenCode authentication reporting', () => {
  it('separates an installed CLI from one with verified credentials', () => {
    expect(parseOpenCodeAuthList('0 credentials')).toEqual({ loggedIn: false, count: 0 });
    expect(parseOpenCodeAuthList('2 credentials')).toEqual({ loggedIn: true, count: 2 });
  });

  it('fails closed when the CLI output does not prove a credential count', () => {
    expect(parseOpenCodeAuthList('OpenCode authentication')).toEqual({ loggedIn: false });
  });
});
