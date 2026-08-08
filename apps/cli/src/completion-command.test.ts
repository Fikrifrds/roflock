import { describe, expect, it } from 'vitest';
import { runCompletion } from './completion-command.js';
import { ExitCode } from './exit-codes.js';

function output() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    io: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
    stdout,
    stderr,
  };
}

describe('completion command', () => {
  it.each(['bash', 'zsh', 'fish'])('emits %s completion for both executable names', (shell) => {
    const result = output();

    expect(runCompletion([shell], result.io)).toBe(ExitCode.Ok);
    expect(result.stdout[0]).toContain('roflock');
    expect(result.stdout[0]).toContain('dry-run');
  });

  it('requires one supported shell', () => {
    const result = output();

    expect(runCompletion(['powershell'], result.io)).toBe(ExitCode.Usage);
    expect(result.stderr[0]).toContain('completion <bash|zsh|fish>');
  });
});
