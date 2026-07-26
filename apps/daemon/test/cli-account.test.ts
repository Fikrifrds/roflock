import { describe, expect, it } from 'vitest';
import { parseCursorAgentStatus } from '../src/services/cli-account.js';

describe('parseCursorAgentStatus', () => {
  it('treats isAuthenticated as signed in even without email', () => {
    expect(
      parseCursorAgentStatus({
        status: 'authenticated',
        isAuthenticated: true,
        hasAccessToken: true,
        message: 'Logged in (unable to fetch user details)',
      }),
    ).toEqual({
      loggedIn: true,
      email: undefined,
      message: 'Logged in (unable to fetch user details)',
    });
  });

  it('treats missing auth flags as signed out', () => {
    expect(parseCursorAgentStatus({ status: 'unauthenticated', isAuthenticated: false })).toEqual({
      loggedIn: false,
      email: undefined,
      message: undefined,
    });
  });

  it('accepts email-only payloads', () => {
    expect(parseCursorAgentStatus({ email: 'dev@example.com' }).loggedIn).toBe(true);
  });
});
