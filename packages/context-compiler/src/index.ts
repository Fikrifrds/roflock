import { sha256Canonical } from '@roleflock/contracts';

export type RoleId = 'planner' | 'reviewer' | 'writer' | 'test' | 'verifier' | 'accept';

export type Sensitivity = 'public' | 'internal' | 'secret';

export interface ContextItem {
  id: string;
  content: string;
  source: string;
  sensitivity?: Sensitivity;
  priority?: number;
  path?: string;
  /** Authority artifacts must never be silently dropped by ranking or budget. */
  required?: boolean;
}

export interface RoleContract {
  role: RoleId;
  purpose: string;
  allowWrites: boolean;
  allowCommands: boolean;
  maxTokens: number;
  preferredSources: string[];
  allowedSensitivity: Sensitivity[];
}

export interface DisclosureEntry {
  id: string;
  source: string;
  hash: string;
  bytes: number;
  tokens: number;
  sensitivity: string;
  path?: string;
}

export interface DisclosureManifest {
  entries: DisclosureEntry[];
  totalBytes: number;
  totalTokens: number;
  exclusions: string[];
  role: RoleId;
}

export interface CompiledContext {
  role: RoleId;
  contract: RoleContract;
  selected: ContextItem[];
  omitted: Array<{ id: string; reason: string }>;
  disclosure: DisclosureManifest;
  promptBlock: string;
}

export const DEFAULT_EXCLUSIONS = [
  '.env',
  '.env.*',
  '**/*.pem',
  '**/*.key',
  '**/*secret*',
  '**/credentials.*',
  '**/id_rsa*',
];

export const ROLE_CONTRACTS: Record<RoleId, RoleContract> = {
  planner: {
    role: 'planner',
    purpose: 'Read-only planning from brief, docs, and repository map',
    allowWrites: false,
    allowCommands: false,
    maxTokens: 4_000,
    preferredSources: ['task.brief', 'document:', 'repo.map', 'knowledge:'],
    allowedSensitivity: ['public', 'internal'],
  },
  reviewer: {
    role: 'reviewer',
    purpose: 'Confirm scope before writes',
    allowWrites: false,
    allowCommands: false,
    maxTokens: 2_500,
    preferredSources: ['task.brief', 'document:', 'knowledge:'],
    allowedSensitivity: ['public', 'internal'],
  },
  writer: {
    role: 'writer',
    purpose: 'Apply leased writes inside the worktree envelope',
    allowWrites: true,
    allowCommands: false,
    maxTokens: 3_000,
    preferredSources: ['task.brief', 'document:', 'repo.map'],
    allowedSensitivity: ['public', 'internal'],
  },
  test: {
    role: 'test',
    purpose: 'Run deterministic checks only',
    allowWrites: false,
    allowCommands: true,
    maxTokens: 500,
    preferredSources: ['task.brief'],
    allowedSensitivity: ['public', 'internal'],
  },
  verifier: {
    role: 'verifier',
    purpose: 'Read-only verification of the proposed change',
    allowWrites: false,
    allowCommands: false,
    maxTokens: 3_500,
    preferredSources: ['task.brief', 'artefact:', 'knowledge:'],
    allowedSensitivity: ['public', 'internal'],
  },
  accept: {
    role: 'accept',
    purpose: 'Human acceptance gate',
    allowWrites: false,
    allowCommands: false,
    maxTokens: 800,
    preferredSources: ['task.brief'],
    allowedSensitivity: ['public', 'internal'],
  },
};

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(Buffer.byteLength(text, 'utf8') / 4));
}

export function pathMatchesExclusion(path: string, pattern: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  const escaped = pattern
    .replace(/\\/g, '/')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*');
  return (
    new RegExp(`^${escaped}$`, 'i').test(normalized) ||
    normalized.includes(pattern.replace(/\*\*/g, '').replace(/\*/g, ''))
  );
}

export function isDeniedPath(
  path: string | undefined,
  exclusions: string[] = DEFAULT_EXCLUSIONS,
): boolean {
  if (!path) return false;
  const normalized = path.replace(/\\/g, '/');
  const base = normalized.split('/').pop() ?? normalized;
  return exclusions.some(
    (pattern) =>
      pathMatchesExclusion(normalized, pattern) ||
      pathMatchesExclusion(base, pattern) ||
      (pattern.includes('*secret*') && /secret/i.test(normalized)),
  );
}

export function selectContext(
  items: ContextItem[],
  maxBytes: number,
  allowedSensitivity: Sensitivity[] = ['public', 'internal'],
): ContextItem[] {
  let used = 0;
  return [...items]
    .filter((item) => allowedSensitivity.includes(item.sensitivity ?? 'internal'))
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .filter((item) => {
      const bytes = Buffer.byteLength(item.content);
      if (used + bytes > maxBytes) return false;
      used += bytes;
      return true;
    });
}

export function buildDisclosureManifest(
  items: ContextItem[],
  options: { role?: RoleId; exclusions?: string[] } = {},
): DisclosureManifest {
  const entries = items.map((item) => ({
    id: item.id,
    source: item.source,
    hash: sha256Canonical(item.content),
    bytes: Buffer.byteLength(item.content),
    tokens: estimateTokens(item.content),
    sensitivity: item.sensitivity ?? 'internal',
    path: item.path,
  }));
  return {
    entries,
    totalBytes: entries.reduce((total, entry) => total + entry.bytes, 0),
    totalTokens: entries.reduce((total, entry) => total + entry.tokens, 0),
    exclusions: options.exclusions ?? DEFAULT_EXCLUSIONS,
    role: options.role ?? 'planner',
  };
}

function sourcePriority(item: ContextItem, preferred: string[]): number {
  const matchIndex = preferred.findIndex(
    (prefix) => item.source.startsWith(prefix) || item.id.startsWith(prefix),
  );
  const preferredBoost = matchIndex === -1 ? 0 : (preferred.length - matchIndex) * 10;
  return preferredBoost + (item.priority ?? 0);
}

/**
 * Compile role-scoped context under a token budget, denying secret paths before
 * any provider sees them.
 */
export function compileContext(input: {
  role: RoleId;
  items: ContextItem[];
  exclusions?: string[];
  maxTokens?: number;
}): CompiledContext {
  const contract = ROLE_CONTRACTS[input.role];
  const exclusions = input.exclusions ?? DEFAULT_EXCLUSIONS;
  const maxTokens = input.maxTokens ?? contract.maxTokens;
  const omitted: Array<{ id: string; reason: string }> = [];

  const eligible: ContextItem[] = [];
  for (const item of input.items) {
    if (isDeniedPath(item.path, exclusions) || isDeniedPath(item.source, exclusions)) {
      omitted.push({ id: item.id, reason: 'denied_by_exclusion' });
      continue;
    }
    if (item.sensitivity === 'secret') {
      omitted.push({ id: item.id, reason: 'secret_sensitivity' });
      continue;
    }
    if (!contract.allowedSensitivity.includes(item.sensitivity ?? 'internal')) {
      omitted.push({ id: item.id, reason: 'sensitivity_not_allowed_for_role' });
      continue;
    }
    eligible.push(item);
  }

  eligible.sort(
    (a, b) =>
      Number(Boolean(b.required)) - Number(Boolean(a.required)) ||
      sourcePriority(b, contract.preferredSources) - sourcePriority(a, contract.preferredSources),
  );

  const selected: ContextItem[] = [];
  let usedTokens = 0;
  for (const item of eligible) {
    const tokens = estimateTokens(item.content);
    if (usedTokens + tokens > maxTokens) {
      if (item.required) {
        throw new Error(
          `Required authority context ${item.id} exceeds the ${maxTokens}-token ${input.role} budget`,
        );
      }
      omitted.push({ id: item.id, reason: 'token_budget' });
      continue;
    }
    selected.push(item);
    usedTokens += tokens;
  }

  const disclosure = buildDisclosureManifest(selected, { role: input.role, exclusions });
  const promptBlock = selected
    .map((item) => `[${item.source}]\n${item.content}`)
    .join('\n\n---\n\n');

  return {
    role: input.role,
    contract,
    selected,
    omitted,
    disclosure,
    promptBlock,
  };
}

export function buildPinnedArtifactContext(input: {
  kind: string;
  id: string;
  hash: string;
  content: string;
}): ContextItem {
  if (!/^[a-f0-9]{64}$/.test(input.hash)) {
    throw new Error(`Pinned ${input.kind} requires a sha256 hash`);
  }
  return {
    id: `artifact:${input.kind}:${input.id}`,
    source: `artifact:${input.kind}:${input.hash}`,
    content: input.content,
    sensitivity: 'internal',
    priority: 1_000,
    required: true,
  };
}

export function buildRepositoryMap(
  paths: string[],
  exclusions: string[] = DEFAULT_EXCLUSIONS,
): ContextItem {
  const allowed = paths.filter((path) => !isDeniedPath(path, exclusions)).slice(0, 200);
  return {
    id: 'repo.map',
    source: 'repo.map',
    content: allowed.length ? allowed.join('\n') : '(empty worktree map)',
    sensitivity: 'internal',
    priority: 40,
  };
}
