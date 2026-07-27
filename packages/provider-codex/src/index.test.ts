import { describe, expect, it } from 'vitest';
import { codexExecArgs } from './index.js';

describe('Codex invocation sandbox', () => {
  it('makes reasoning turns explicitly read-only', () => {
    const args = codexExecArgs({
      invocationId: 'inv-read',
      prompt: 'review this',
      cwd: '/tmp/repository',
      model: 'gpt-5.6-terra',
      effort: 'medium',
    });

    expect(args).toContain('read-only');
    expect(args).toContain('/tmp/repository');
    expect(args).not.toContain('workspace-write');
    expect(args).not.toContain('danger-full-access');
  });

  it('limits writer turns to the leased worktree', () => {
    const args = codexExecArgs({
      invocationId: 'inv-write',
      prompt: 'implement the fix',
      cwd: '/tmp/source',
      permissionEnvelope: {
        worktree: '/tmp/leased-worktree',
        allowedPaths: ['**'],
        allowCommands: true,
      },
    });

    expect(args).toContain('workspace-write');
    expect(args).toContain('/tmp/leased-worktree');
    expect(args).not.toContain('/tmp/source');
    expect(args).toContain('--ephemeral');
    expect(args).not.toContain('danger-full-access');
  });
});
