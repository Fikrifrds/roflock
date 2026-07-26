import { describe, expect, it } from 'vitest';
import {
  buildRepositoryMap,
  compileContext,
  isDeniedPath,
  ROLE_CONTRACTS,
} from './index.js';

describe('context compiler', () => {
  it('denies secret paths before selection', () => {
    expect(isDeniedPath('.env')).toBe(true);
    expect(isDeniedPath('certs/app.pem')).toBe(true);
    expect(isDeniedPath('src/main.ts')).toBe(false);
  });

  it('compiles under token budget and records omissions', () => {
    const compiled = compileContext({
      role: 'planner',
      maxTokens: 20,
      items: [
        { id: 'a', source: 'task.brief', content: 'short brief', priority: 100 },
        {
          id: 'b',
          source: 'document:huge.md',
          content: 'x'.repeat(500),
          priority: 10,
        },
        {
          id: 'secret',
          source: 'file:.env',
          path: '.env',
          content: 'SECRET=1',
          priority: 1000,
        },
      ],
    });
    expect(compiled.selected.some((item) => item.id === 'a')).toBe(true);
    expect(compiled.omitted.some((item) => item.id === 'secret' && item.reason === 'denied_by_exclusion')).toBe(
      true,
    );
    expect(compiled.disclosure.totalTokens).toBeLessThanOrEqual(20);
    expect(compiled.disclosure.entries.every((entry) => entry.tokens > 0)).toBe(true);
    expect(ROLE_CONTRACTS.planner.allowWrites).toBe(false);
  });

  it('builds repository maps without denied files', () => {
    const map = buildRepositoryMap(['README.md', '.env', 'src/app.ts']);
    expect(map.content).toContain('README.md');
    expect(map.content).not.toContain('.env');
  });
});
