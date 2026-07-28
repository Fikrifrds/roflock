import { describe, expect, it } from 'vitest';
import { normalizeLiveOutput } from '../src/components/LiveTurn.js';

describe('normalizeLiveOutput', () => {
  it('turns JSON-style escape dumps into real newlines', () => {
    const raw =
      "+  searchEl.value = '';\\n+  query = '';\\n+  renderList(false);\\n+}\\n+});\\n\\n+function flushPending() {";
    const normalized = normalizeLiveOutput(raw);
    expect(normalized).toContain("\n+  query = '';\n");
    expect(normalized.split('\n').length).toBeGreaterThan(4);
    expect(normalized).not.toContain('\\n');
  });

  it('leaves already-readable output alone', () => {
    const text = 'Writing index.html\n\n<!doctype html>\n<html>\n';
    expect(normalizeLiveOutput(text)).toBe(text);
  });
});
