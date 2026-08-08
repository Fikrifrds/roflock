import { createId, sha256Canonical } from '@roleflock/contracts';
export interface EvidenceItem {
  type: string;
  content: unknown;
  createdAt?: string;
}
export interface EvidenceBundle {
  id: string;
  createdAt: string;
  items: Array<EvidenceItem & { hash: string }>;
  rootHash: string;
}
export function buildEvidenceBundle(
  items: EvidenceItem[],
  createdAt = new Date().toISOString(),
): EvidenceBundle {
  const normalized = items.map((item) => ({
    ...item,
    createdAt: item.createdAt ?? createdAt,
    hash: sha256Canonical({ type: item.type, content: item.content }),
  }));
  return {
    id: createId('evidence'),
    createdAt,
    items: normalized,
    rootHash: sha256Canonical(normalized.map((item) => item.hash)),
  };
}
export function verifyEvidenceBundle(bundle: EvidenceBundle): boolean {
  return (
    bundle.items.every(
      (item) => item.hash === sha256Canonical({ type: item.type, content: item.content }),
    ) && bundle.rootHash === sha256Canonical(bundle.items.map((item) => item.hash))
  );
}
export * from './explain.js';
