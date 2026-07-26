import { describe, expect, it } from 'vitest';
import { actionFingerprint } from './index.js';
describe('actionFingerprint', () => {
  it('canonicalises object keys and path ordering', () => {
    expect(actionFingerprint({ kind: 'file', verb: 'write', paths: ['b.ts', 'a.ts'], metadata: { b: 2, a: 1 } }))
      .toBe(actionFingerprint({ verb: 'write', kind: 'file', paths: ['a.ts', 'b.ts'], metadata: { a: 1, b: 2 } }));
  });
});
