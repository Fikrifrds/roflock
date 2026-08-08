import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const tag = process.env.GITHUB_REF_NAME;

if (!tag) throw new Error('GITHUB_REF_NAME is required');
if (tag !== `v${manifest.version}`) {
  throw new Error(`release tag ${tag} must exactly match package version v${manifest.version}`);
}
process.stdout.write(`${manifest.name}@${manifest.version}\n`);
