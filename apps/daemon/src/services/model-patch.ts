import { runCommand, CommandError } from '@roleflock/command-runner';
import type { PermissionEnvelope } from '@roleflock/provider-core';
import { assertPathAllowed } from '@roleflock/provider-cursor';
import { DEFAULT_DENIED_GLOBS, matchesGlob } from '@roleflock/repository-runtime';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export class ModelPatchError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ModelPatchError';
  }
}

/** Accept only a git-style unified diff, optionally wrapped in one Markdown fence. */
export function extractUnifiedDiff(output: string): string {
  const fenced = output.match(/```(?:diff|patch)?\s*\n([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? output).trim();
  const start = candidate.indexOf('diff --git ');
  if (start < 0) {
    throw new ModelPatchError(
      'The writer returned text instead of a git unified diff. No files were changed.',
    );
  }
  const patch = `${candidate.slice(start).trim()}\n`;
  if (!/^diff --git a\/.+ b\/.+$/m.test(patch) || !/^@@ /m.test(patch)) {
    throw new ModelPatchError(
      'The writer returned an incomplete unified diff. No files were changed.',
    );
  }
  return patch;
}

/** Reject ambiguous or escaping paths before git sees the model-generated patch. */
export function assertPatchPathsAllowed(patch: string, envelope: PermissionEnvelope): string[] {
  const paths: string[] = [];
  for (const line of patch.split('\n')) {
    if (!line.startsWith('diff --git ')) continue;
    const match = /^diff --git a\/([^\t"]+) b\/([^\t"]+)$/.exec(line);
    if (!match) {
      throw new ModelPatchError(
        'The writer returned an ambiguous patch path. No files were changed.',
      );
    }
    for (const path of [match[1]!, match[2]!]) {
      assertPathAllowed(envelope, path);
      if (DEFAULT_DENIED_GLOBS.some((glob) => matchesGlob(path, glob))) {
        throw new ModelPatchError(
          `The writer patch targets a sensitive path (${path}). No files were changed.`,
        );
      }
      paths.push(path);
    }
  }
  if (!paths.length) {
    throw new ModelPatchError('The writer patch contains no file paths. No files were changed.');
  }
  return [...new Set(paths)];
}

/**
 * Validates first, then applies through Git inside the leased worktree. Git's
 * default path safety remains enabled; `--unsafe-paths` is deliberately absent.
 */
export async function applyModelPatch(
  output: string,
  envelope: PermissionEnvelope,
): Promise<{ patch: string; paths: string[] }> {
  const patch = extractUnifiedDiff(output);
  const paths = assertPatchPathsAllowed(patch, envelope);
  const command = (args: string[]) =>
    runCommand({
      command: 'git',
      args,
      cwd: envelope.worktree,
      sandboxRoot: envelope.worktree,
      input: patch,
      timeoutMs: 60_000,
    });

  try {
    await command(['apply', '--check', '-']);
    await command(['apply', '-']);
  } catch (error) {
    const detail =
      error instanceof CommandError
        ? error.result.stderr.trim() || error.result.stdout.trim()
        : error instanceof Error
          ? error.message
          : String(error);
    throw new ModelPatchError(
      `The writer produced a patch Git could not apply${detail ? `: ${detail.slice(0, 500)}` : '.'}`,
      { cause: error },
    );
  }
  return { patch, paths };
}

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'vendor',
]);
const SOURCE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.css',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.php',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.toml',
  '.ts',
  '.tsx',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
]);
const CONFIG_NAMES = new Set([
  'Dockerfile',
  'Gemfile',
  'Makefile',
  'Procfile',
  'README',
  'eslint.config.js',
  'package-lock.json',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
]);

function isReadableSource(path: string): boolean {
  const name = path.split('/').at(-1) ?? path;
  if (CONFIG_NAMES.has(name) || /^README(?:\..+)?$/i.test(name)) return true;
  const dot = name.lastIndexOf('.');
  return dot >= 0 && SOURCE_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function contextScore(path: string, content: string, keywords: string[]): number {
  const lower = path.toLowerCase();
  const lowerContent = content.toLowerCase();
  return (
    keywords.reduce(
      (score, keyword) =>
        score + (lower.includes(keyword) ? 10 : 0) + (lowerContent.includes(keyword) ? 4 : 0),
      0,
    ) - path.split('/').length
  );
}

async function readPrefix(path: string, maxBytes: number): Promise<string> {
  const file = await open(path, 'r').catch(() => undefined);
  if (!file) return '';
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await file.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await file.close();
  }
}

/**
 * Gives an API-only writer enough repository context to create a useful patch
 * without exposing secrets or sending an unbounded checkout to the model.
 */
export async function buildPatchWriterContext(worktree: string, brief: string): Promise<string> {
  const candidates: string[] = [];
  let visitedEntries = 0;

  const walk = async (relativeDirectory = ''): Promise<void> => {
    if (candidates.length >= 400 || visitedEntries >= 2_000) return;
    const entries = await readdir(join(worktree, relativeDirectory), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      visitedEntries += 1;
      if (candidates.length >= 400 || visitedEntries >= 2_000) break;
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (
        DEFAULT_DENIED_GLOBS.some((glob) => matchesGlob(relativePath, glob)) ||
        entry.isSymbolicLink()
      ) {
        continue;
      }
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(relativePath);
      } else if (entry.isFile() && isReadableSource(relativePath)) {
        candidates.push(relativePath);
      }
    }
  };

  await walk();
  if (!candidates.length) {
    return 'Repository snapshot: the worktree has no readable source files yet.';
  }

  const keywords = [
    ...new Set(
      brief
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/)
        .filter((word) => word.length >= 3),
    ),
  ];
  const readable = (
    await Promise.all(
      candidates.map(async (path) => ({
        path,
        content: await readPrefix(join(worktree, path), 24_000),
      })),
    )
  ).filter((file) => file.content && !file.content.includes('\0'));
  readable.sort(
    (a, b) =>
      contextScore(b.path, b.content, keywords) - contextScore(a.path, a.content, keywords) ||
      a.path.localeCompare(b.path),
  );

  const sections: string[] = [];
  let total = 0;
  for (const { path, content } of readable.slice(0, 48)) {
    const clipped =
      content.length > 12_000 ? `${content.slice(0, 12_000)}\n[truncated by RoleFlock]\n` : content;
    const section = `--- ${path} ---\n${clipped}`;
    if (total + section.length > 100_000) break;
    sections.push(section);
    total += section.length;
  }

  return sections.length
    ? `Repository snapshot for patch generation (bounded; sensitive and generated files excluded):\n${sections.join('\n')}`
    : 'Repository snapshot: no safe UTF-8 source files could be included.';
}
