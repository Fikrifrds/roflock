import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/verify-sbom.mjs <bom.cdx.json>');
const bom = JSON.parse(readFileSync(path, 'utf8'));
if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.5') {
  throw new Error('Expected CycloneDX 1.5 document');
}
if (
  bom.metadata?.component?.name !== 'roflock' ||
  typeof bom.metadata.component.version !== 'string'
) {
  throw new Error('SBOM root component must be roflock with a version');
}
if (
  !Array.isArray(bom.components) ||
  bom.components.some((component) => component.type !== 'library')
) {
  throw new Error('SBOM components must be external library entries');
}
if (!Array.isArray(bom.dependencies) || bom.dependencies.length === 0) {
  throw new Error('SBOM must record dependency relationships');
}
process.stdout.write(
  `Verified CycloneDX SBOM for roflock@${bom.metadata.component.version} (${bom.components.length} libraries)\n`,
);
