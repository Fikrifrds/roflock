import { describe, expect, it } from 'vitest';
import { resolvePlaygroundUrl } from '../src/lib/links.js';

describe('Playground launch URL', () => {
  it('uses the isolated local dev server during development', () => {
    expect(resolvePlaygroundUrl({ DEV: true })).toBe('http://127.0.0.1:5174/');
  });

  it('hides the production shortcut when no public origin is configured', () => {
    expect(resolvePlaygroundUrl({ DEV: false })).toBeUndefined();
  });

  it('accepts and normalises an absolute public URL', () => {
    expect(
      resolvePlaygroundUrl({
        DEV: false,
        VITE_PLAYGROUND_URL: '  https://roflock.com/play  ',
      }),
    ).toBe('https://roflock.com/play');
  });

  it('rejects relative, executable, insecure, and loopback production URLs', () => {
    expect(resolvePlaygroundUrl({ VITE_PLAYGROUND_URL: '/playground/' })).toBeUndefined();
    expect(resolvePlaygroundUrl({ VITE_PLAYGROUND_URL: 'javascript:alert(1)' })).toBeUndefined();
    expect(
      resolvePlaygroundUrl({ DEV: false, VITE_PLAYGROUND_URL: 'http://roflock.test/play' }),
    ).toBeUndefined();
    expect(
      resolvePlaygroundUrl({ DEV: false, VITE_PLAYGROUND_URL: 'https://127.0.0.1:4178/play' }),
    ).toBeUndefined();
    expect(
      resolvePlaygroundUrl({ DEV: false, VITE_PLAYGROUND_URL: 'https://localhost/play' }),
    ).toBeUndefined();
  });
});
