import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  applyModelPatch,
  assertPatchPathsAllowed,
  buildPatchWriterContext,
  extractUnifiedDiff,
  ModelPatchError,
} from '../src/services/model-patch.js';

const exec = promisify(execFile);

async function worktree() {
  const root = await mkdtemp(join(tmpdir(), 'rf-model-patch-'));
  await exec('git', ['init', '--initial-branch=main'], { cwd: root });
  return root;
}

const newFilePatch = `diff --git a/src/greeting.ts b/src/greeting.ts
new file mode 100644
--- /dev/null
+++ b/src/greeting.ts
@@ -0,0 +1 @@
+export const greeting = 'hello';
`;

describe('model patch writer', () => {
  it('extracts a fenced unified diff and applies it inside the leased worktree', async () => {
    const root = await worktree();
    const result = await applyModelPatch(`\`\`\`diff\n${newFilePatch}\`\`\``, {
      worktree: root,
      allowedPaths: ['**'],
      allowCommands: true,
    });

    expect(result.paths).toEqual(['src/greeting.ts']);
    expect(await readFile(join(root, 'src/greeting.ts'), 'utf8')).toBe(
      "export const greeting = 'hello';\n",
    );
  });

  it('rejects prose, traversal, and sensitive paths before changing files', async () => {
    const root = await worktree();
    const envelope = { worktree: root, allowedPaths: ['**'], allowCommands: true };

    expect(() => extractUnifiedDiff('I changed the requested file.')).toThrow(ModelPatchError);
    expect(() =>
      assertPatchPathsAllowed(
        'diff --git a/../outside.ts b/../outside.ts\n@@ -0,0 +1 @@\n+x\n',
        envelope,
      ),
    ).toThrow(/denied/i);
    expect(() =>
      assertPatchPathsAllowed('diff --git a/.env b/.env\n@@ -0,0 +1 @@\n+TOKEN=x\n', envelope),
    ).toThrow(/sensitive path/i);
  });

  it('builds bounded task-aware context without secrets or generated files', async () => {
    const root = await worktree();
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'src', 'auth.ts'), 'export const authenticate = () => true;\n');
    await writeFile(join(root, 'src', 'other.ts'), 'export const other = 1;\n');
    await writeFile(join(root, '.env'), 'SECRET=never-send-this\n');
    await writeFile(join(root, 'dist', 'bundle.js'), 'generated content\n');

    const context = await buildPatchWriterContext(root, 'Fix authentication in auth');

    expect(context).toContain('--- src/auth.ts ---');
    expect(context.indexOf('src/auth.ts')).toBeLessThan(context.indexOf('src/other.ts'));
    expect(context).not.toContain('never-send-this');
    expect(context).not.toContain('generated content');
    expect(context.length).toBeLessThanOrEqual(100_500);
  });
});
