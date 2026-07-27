import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Find a safe, conventional verification command without executing it. */
export async function discoverVerificationCommand(root: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    if (pkg.scripts?.test) return 'npm test --silent';
  } catch {
    // No root Node manifest, or it has no test script.
  }

  if (existsSync(join(root, 'pytest.ini')) || existsSync(join(root, 'pyproject.toml'))) {
    return 'python3 -m pytest';
  }

  for (const directory of ['spike', 'app', '']) {
    const folder = join(root, directory);
    if (!existsSync(folder)) continue;
    const tests = readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^test_.*\.py$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    if (!tests.length) continue;
    // Python adds a script's own directory to sys.path, so this works from
    // RoleFlock's worktree root without handing user input to a shell.
    return `python3 ${directory ? `${directory}/` : ''}${tests[0]}`;
  }
  return undefined;
}
