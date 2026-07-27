import { describe, expect, it } from 'vitest';
import { parseVerifierVerdict } from '../src/services/orchestrator.js';

describe('verifier verdict', () => {
  it('reads a passing verdict', () => {
    expect(parseVerifierVerdict('Looks correct.\nVERDICT: PASS')).toEqual({ decision: 'pass' });
  });

  it('reads a rejection with its reason', () => {
    expect(
      parseVerifierVerdict('VERDICT: NEEDS_CHANGES — the fix does not cover the null input case'),
    ).toEqual({
      decision: 'needs_changes',
      reason: 'the fix does not cover the null input case',
    });
  });

  it('accepts the spaced and colon-separated spellings', () => {
    expect(parseVerifierVerdict('VERDICT: NEEDS CHANGES: missing test').decision).toBe(
      'needs_changes',
    );
    expect(parseVerifierVerdict('verdict: needs_changes').decision).toBe('needs_changes');
  });

  it('takes the last verdict when the model restates the format first', () => {
    const output = [
      'I must end with either:',
      '  VERDICT: PASS',
      'or VERDICT: NEEDS_CHANGES — reason',
      '',
      'The change is complete.',
      'VERDICT: PASS',
    ].join('\n');
    expect(parseVerifierVerdict(output).decision).toBe('pass');
  });

  it('reports inconclusive rather than guessing', () => {
    // Silence must not read as approval, and it must not read as rejection
    // either — the required deterministic check is what actually gates accept.
    expect(parseVerifierVerdict('Looks fine to me.').decision).toBe('inconclusive');
    expect(parseVerifierVerdict(undefined).decision).toBe('inconclusive');
    expect(parseVerifierVerdict('').decision).toBe('inconclusive');
  });

  it('does not invent a reason when none is given', () => {
    expect(parseVerifierVerdict('VERDICT: NEEDS_CHANGES')).toEqual({
      decision: 'needs_changes',
      reason: undefined,
    });
  });
});
