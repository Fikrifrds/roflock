import { sha256Canonical } from '@roleflock/contracts';
export interface ContextItem { id: string; content: string; source: string; sensitivity?: 'public' | 'internal' | 'secret'; priority?: number; }
export interface DisclosureManifest { entries: Array<{ id: string; source: string; hash: string; bytes: number; sensitivity: string }>; totalBytes: number; }
export function selectContext(items: ContextItem[], maxBytes: number, allowedSensitivity: ContextItem['sensitivity'][] = ['public', 'internal']): ContextItem[] {
  let used = 0; return [...items].filter((item) => allowedSensitivity.includes(item.sensitivity ?? 'internal')).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0)).filter((item) => { const bytes = Buffer.byteLength(item.content); if (used + bytes > maxBytes) return false; used += bytes; return true; });
}
export function buildDisclosureManifest(items: ContextItem[]): DisclosureManifest {
  const entries = items.map((item) => ({ id: item.id, source: item.source, hash: sha256Canonical(item.content), bytes: Buffer.byteLength(item.content), sensitivity: item.sensitivity ?? 'internal' }));
  return { entries, totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0) };
}
