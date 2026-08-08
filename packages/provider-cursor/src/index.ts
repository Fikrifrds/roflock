import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { InvocationEvent } from '@roleflock/contracts';
import {
  classifyProviderFailure,
  isEffort,
  parseReportedUsage,
  refusalInOutput,
  whichBinary,
  type InvocationRequest,
  type ProviderAdapter,
  type ProviderCapabilities,
  type ProviderHealth,
  type ProviderModel,
  type PermissionEnvelope,
} from '@roleflock/provider-core';
import { readEnv } from '@roleflock/contracts';

const execFileAsync = promisify(execFile);

async function resolveCandidate(candidate: string): Promise<string | undefined> {
  if (isAbsolute(candidate)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      return undefined;
    }
  }
  return whichBinary(candidate);
}

export interface CursorWriter {
  write(path: string, content: string): Promise<void>;
  invoke?(prompt: string, signal?: AbortSignal): AsyncIterable<string>;
}

/** Filesystem-backed writer used under RoleFlock's permission envelope. */
export function createFsCursorWriter(): CursorWriter {
  return {
    write: async (path, content) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
    },
  };
}

function isWholeTreeAllow(allowedPaths: string[]): boolean {
  return allowedPaths.includes('**') || allowedPaths.includes('*');
}

export function assertPathAllowed(envelope: PermissionEnvelope, path: string): string {
  const destination = resolve(envelope.worktree, path);
  const relativePath = relative(envelope.worktree, destination);
  if (relativePath.startsWith('..') || relativePath === '') {
    throw new Error(`Write denied: ${path}`);
  }
  if (isWholeTreeAllow(envelope.allowedPaths)) {
    return destination;
  }
  if (
    !envelope.allowedPaths.some(
      (allowed) => relativePath === allowed || relativePath.startsWith(`${allowed}/`),
    )
  ) {
    throw new Error(`Write denied: ${path}`);
  }
  return destination;
}

/** Reject agent/tool writes that escaped the permission envelope. */
export function assertChangedPathsAllowed(
  envelope: PermissionEnvelope,
  changedFiles: string[],
): void {
  for (const file of changedFiles) {
    const normalized = file.includes(' -> ') ? file.split(' -> ').pop()!.trim() : file.trim();
    if (!normalized || normalized === '.') continue;
    assertPathAllowed(envelope, normalized);
  }
}

const INSTALL_HINT = 'Install with: curl https://cursor.com/install -fsS | bash';

/** Other vendors ship generic agent binaries; never mistake one for Cursor. */
function isForeignAgent(binary: string): boolean {
  return /[\\/]\.(grok|gemini|qwen)[\\/]/.test(binary);
}

async function looksLikeCursorAgent(binary: string): Promise<boolean> {
  if (isForeignAgent(binary)) return false;
  try {
    const { stdout, stderr } = await execFileAsync(binary, ['--help'], {
      timeout: 8_000,
      env: process.env,
    });
    const text = `${stdout}\n${stderr}`;
    if (/\bgrok\b|\bxai\b/i.test(text)) return false;
    return (
      /--print\b/.test(text) &&
      (/--force\b/.test(text) || /--yolo\b/.test(text) || /cursor/i.test(text))
    );
  } catch {
    return false;
  }
}

/**
 * Discover only the explicitly named Cursor Agent CLI (`cursor-agent`). A bare
 * `agent` binary is deliberately never probed: other providers (such as Grok)
 * use that generic name too.
 *
 * An explicitly configured binary — the `binary` argument or `CURSOR_AGENT_PATH` — is
 * authoritative: if it is missing or is not the Cursor Agent CLI the
 * result is `missing`. Falling back to PATH there would silently run a different binary
 * than the one the operator configured.
 */
export async function discoverCursor(
  binary?: string,
): Promise<Pick<ProviderHealth, 'binary' | 'version' | 'status' | 'detail'>> {
  const configured = binary ?? process.env.CURSOR_AGENT_PATH;

  if (configured) {
    const resolved = await resolveCandidate(configured);
    if (!resolved) {
      return { status: 'missing', detail: `Configured Cursor binary not found: ${configured}` };
    }
    if (!(await looksLikeCursorAgent(resolved))) {
      return {
        status: 'missing',
        detail: `Configured binary is not the Cursor Agent CLI: ${resolved}`,
      };
    }
    return { status: 'ready', binary: resolved };
  }

  const resolved = await resolveCandidate('cursor-agent');
  if (resolved && (await looksLikeCursorAgent(resolved)))
    return { status: 'ready', binary: resolved };

  return {
    status: 'missing',
    detail: `Cursor Agent CLI was not found on PATH. ${INSTALL_HINT}`,
  };
}

/** Trailing effort segment of a Cursor model id, if it has one. */
const CURSOR_EFFORT_SUFFIX = /-(none|low|medium|high|xhigh|max)(-fast)?$/;

/**
 * Parses `cursor-agent --list-models`, whose output is a header followed by
 * `<id> - <Display Name>` lines.
 *
 * Cursor encodes effort in the id (`claude-opus-5-high`, `cursor-grok-4.5-low`),
 * so the effort and family are recovered here. That is what lets the picker
 * group by family and show effort as its own column, rather than making the
 * user read it out of a slug.
 */
export function parseCursorModelList(stdout: string): ProviderModel[] {
  const models: ProviderModel[] = [];
  const seen = new Set<string>();

  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    const match = /^([A-Za-z0-9][\w.-]*)\s+-\s+(.+)$/.exec(line);
    if (!match) continue;

    const [, id, displayName] = match as unknown as [string, string, string];
    if (seen.has(id)) continue;
    seen.add(id);

    const effort = CURSOR_EFFORT_SUFFIX.exec(id)?.[1];
    models.push({
      id,
      displayName,
      ...(isEffort(effort) ? { effort } : {}),
      ...(isEffort(effort) ? { supportedEffort: [effort] } : {}),
      family: id.replace(CURSOR_EFFORT_SUFFIX, '').replace(/-fast$/, ''),
      catalogueSource: 'runtime_catalogue',
    });
  }

  return models;
}

/** Cursor reports real token counts on its closing `result` frame. */
function extractStreamUsage(line: string): ReturnType<typeof parseReportedUsage> {
  try {
    const json = JSON.parse(line) as Record<string, unknown>;
    return parseReportedUsage(json.usage);
  } catch {
    return undefined;
  }
}

type ToolCallEnvelope = {
  writeToolCall?: { args?: { path?: unknown; fileText?: unknown } };
  readToolCall?: {
    args?: { path?: unknown };
    result?: { success?: { content?: unknown; totalLines?: unknown } };
  };
  editToolCall?: { args?: { path?: unknown; oldString?: unknown; newString?: unknown } };
  function?: { name?: unknown; arguments?: unknown };
};

/**
 * Turns one Cursor stream-json NDJSON line into human-readable live output.
 * Incomplete lines must not be passed here — callers buffer until a full line.
 * Never returns the raw JSON: that surfaces literal `\n` escapes in the UI.
 */
export function extractStreamText(line: string): string | undefined {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  if (json.type === 'assistant' && json.message && typeof json.message === 'object') {
    // With --stream-partial-output, buffered flushes duplicate earlier deltas.
    if ('model_call_id' in json) return undefined;
    const message = json.message as { content?: Array<{ text?: string }> };
    const text = (message.content ?? [])
      .map((part) => part.text)
      .filter((value): value is string => Boolean(value))
      .join('');
    return text || undefined;
  }

  if (json.type === 'tool_call') {
    return formatToolCallText(json);
  }

  // Terminal `result` concatenates assistant text again; skip to avoid noise.
  if (json.type === 'result') return undefined;

  if (typeof json.text === 'string') return json.text;
  if (typeof json.delta === 'string') return json.delta;
  return undefined;
}

function formatToolCallText(json: Record<string, unknown>): string | undefined {
  const subtype = typeof json.subtype === 'string' ? json.subtype : '';
  const toolCall = json.tool_call as ToolCallEnvelope | undefined;
  if (!toolCall || typeof toolCall !== 'object') return undefined;

  const write = toolCall.writeToolCall;
  if (write?.args && typeof write.args.path === 'string') {
    const path = write.args.path;
    if (subtype === 'started' && typeof write.args.fileText === 'string') {
      return `\n▸ Writing ${path}\n\n${write.args.fileText}\n`;
    }
    if (subtype === 'completed') return `\n✓ Wrote ${path}\n`;
    return `\n▸ Writing ${path}\n`;
  }

  const read = toolCall.readToolCall;
  if (read?.args && typeof read.args.path === 'string') {
    const path = read.args.path;
    if (subtype === 'completed') {
      const lines = read.result?.success?.totalLines;
      return typeof lines === 'number'
        ? `\n▸ Read ${path} (${lines} lines)\n`
        : `\n▸ Read ${path}\n`;
    }
    return `\n▸ Reading ${path}\n`;
  }

  const edit = toolCall.editToolCall;
  if (edit?.args && typeof edit.args.path === 'string') {
    const path = edit.args.path;
    if (subtype === 'started' && typeof edit.args.newString === 'string') {
      return `\n▸ Editing ${path}\n\n${edit.args.newString}\n`;
    }
    return `\n▸ Editing ${path}\n`;
  }

  const fn = toolCall.function;
  if (fn && typeof fn.name === 'string') {
    const name = fn.name;
    if (subtype === 'started' && typeof fn.arguments === 'string') {
      const decoded = decodeJsonishArguments(fn.arguments);
      return decoded ? `\n▸ ${name}\n\n${decoded}\n` : `\n▸ ${name}\n`;
    }
    return `\n▸ ${name}\n`;
  }

  return undefined;
}

/** Prefer a pretty object dump when tool arguments arrive as a JSON string. */
function decodeJsonishArguments(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      for (const key of [
        'fileText',
        'contents',
        'content',
        'new_string',
        'newString',
        'patch',
        'diff',
      ]) {
        if (typeof record[key] === 'string') return record[key] as string;
      }
      return JSON.stringify(parsed, null, 2);
    }
    if (typeof parsed === 'string') return parsed;
  } catch {
    // Arguments may already be plain text.
  }
  return looksEscaped(raw) ? unescapeJsonString(raw) : raw;
}

function looksEscaped(value: string): boolean {
  const escapedNewlines = (value.match(/\\n/g) ?? []).length;
  const realNewlines = (value.match(/\n/g) ?? []).length;
  return escapedNewlines >= 3 && escapedNewlines > realNewlines * 2;
}

function unescapeJsonString(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

/** Cursor writer adapter backed by the live Cursor Agent CLI. */
export class CursorWriterAdapter implements ProviderAdapter {
  readonly id = 'cursor';
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    writes: true,
    headless: true,
  };

  constructor(
    private readonly writer: CursorWriter = createFsCursorWriter(),
    private readonly binaryHint = process.env.CURSOR_AGENT_PATH,
  ) {}

  async healthCheck(): Promise<ProviderHealth> {
    const discovery = await discoverCursor(this.binaryHint);
    if (discovery.status === 'ready') {
      return {
        ...discovery,
        detail: `Cursor Agent CLI ready (${discovery.binary})`,
      };
    }
    return discovery;
  }

  async detectCapabilities(): Promise<ProviderCapabilities> {
    const discovery = await discoverCursor(this.binaryHint);
    return {
      ...this.capabilities,
      tools: discovery.status === 'ready',
      headless: discovery.status === 'ready',
    };
  }

  async listModels(): Promise<ProviderModel[]> {
    const discovery = await discoverCursor(this.binaryHint);
    if (discovery.status !== 'ready' || !discovery.binary) {
      return [{ id: 'cursor-agent', displayName: 'Cursor Agent (default)' }];
    }
    try {
      const { stdout } = await execFileAsync(discovery.binary, ['--list-models'], {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
        env: process.env,
      });
      const models = parseCursorModelList(stdout);
      return models.length ? models : [{ id: 'auto', displayName: 'Auto (default)' }];
    } catch {
      // The catalogue is an account-scoped network call. Losing it should cost
      // the picker its choices, not take the provider down.
      return [{ id: 'auto', displayName: 'Auto (default)' }];
    }
  }

  async hasAgentCli(): Promise<boolean> {
    const discovery = await discoverCursor(this.binaryHint);
    return discovery.status === 'ready';
  }

  async write(path: string, content: string, envelope: PermissionEnvelope): Promise<void> {
    const destination = assertPathAllowed(envelope, path);
    await this.writer.write(destination, content);
  }

  async *invoke(request: InvocationRequest): AsyncIterable<InvocationEvent> {
    // An envelope means "you may write, here". Without one this is a read-only
    // turn — a planner or verifier reasoning about the repository. Cursor is
    // the provider that carries most of the model catalogue, so refusing to run
    // it read-only would put those models out of reach of every role but the
    // writer.
    const envelope = request.permissionEnvelope;
    const readOnly = !envelope?.worktree;

    yield { type: 'invocation.started', invocationId: request.invocationId };
    yield { type: 'heartbeat', at: new Date().toISOString() };

    if (this.writer.invoke && envelope) {
      for await (const text of this.writer.invoke(request.prompt, request.signal)) {
        yield { type: 'model.output.delta', text };
      }
      yield { type: 'invocation.completed', output: '' };
      return;
    }

    const forceFs = readEnv('CURSOR_AGENT') === '0' || readEnv('FORCE_FAKE') === '1';
    const discovery = forceFs
      ? { status: 'missing' as const }
      : await discoverCursor(this.binaryHint);

    if (readOnly && discovery.status !== 'ready') {
      // The leased-write fallback below cannot stand in for a reasoning turn.
      throw new Error('Cursor Agent CLI is required for read-only Cursor turns.');
    }

    if (discovery.status === 'ready' && discovery.binary) {
      const workspace = envelope?.worktree ?? request.cwd;
      const args = ['-p', '--trust', '--output-format', 'stream-json'];
      if (workspace) args.push('--workspace', workspace);
      // Cursor's catalogue encodes effort in the model id (`claude-opus-5-high`
      // vs `-low`), so there is no separate effort flag to pass here.
      if (request.model) args.push('--model', request.model);

      if (readOnly) {
        // No --force: a read-only turn must not be able to auto-run tool calls.
        args.push('--sandbox', 'enabled');
      } else {
        args.push('--force');
        if (envelope?.allowCommands === false) args.push('--sandbox', 'enabled');
      }
      args.push(request.prompt);

      const child = spawn(discovery.binary, args, {
        cwd: request.cwd ?? envelope?.worktree,
        signal: request.signal,
        env: process.env,
      });
      if (child.pid) request.onSpawn?.(child.pid);
      let stderr = '';
      child.stderr.on('data', (d: Buffer) => {
        stderr += d;
      });
      // Aborting a spawned child makes Node emit `error` on it. With no listener
      // that is an unhandled error event, which takes the whole daemon down —
      // pressing Stop killed the process that was meant to do the stopping.
      let aborted = false;
      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.name === 'AbortError') aborted = true;
        else stderr += `\n${error.message}`;
      });

      // stdin is never written to; leaving the pipe open makes the CLI wait on
      // input that will never arrive.
      child.stdin?.end();

      // Write tool events are one giant NDJSON line. Chunk boundaries must not
      // flush a partial line — that dumps JSON with literal `\n` into the UI.
      let lineBuffer = '';
      for await (const chunk of child.stdout) {
        yield { type: 'heartbeat', at: new Date().toISOString() };
        lineBuffer += String(chunk);
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const usage = extractStreamUsage(line);
          if (usage) yield { type: 'usage.updated', usage: { ...usage } };
          const text = extractStreamText(line);
          if (text) yield { type: 'model.output.delta', text };
        }
      }
      if (lineBuffer.trim()) {
        const usage = extractStreamUsage(lineBuffer);
        if (usage) yield { type: 'usage.updated', usage: { ...usage } };
        const text = extractStreamText(lineBuffer);
        if (text) yield { type: 'model.output.delta', text };
      }

      const code: number = await new Promise((resolve) =>
        child.on('close', (value) => resolve(value ?? 1)),
      );
      if (aborted || request.signal?.aborted) {
        // Why the signal fired is the caller's to know; see provider-claude.
        yield { type: 'invocation.interrupted', reason: 'Provider run aborted before completion' };
        return;
      }
      // Cursor Agent reports an unusable model on stderr and still exits 0, so
      // the exit code alone cannot be trusted to mean the work happened.
      const refusal = code === 0 ? refusalInOutput(stderr) : classifyProviderFailure(stderr);
      if (refusal) {
        yield {
          type: 'invocation.failed',
          error: {
            code: `CURSOR_${refusal.toUpperCase()}`,
            message: stderr.trim().slice(0, 600) || `Cursor Agent exit ${code}`,
            // A quota or unknown-model failure cannot succeed on a retry with
            // the same model; the router must move on rather than loop.
            retryable: refusal === 'transient' || refusal === 'unknown',
          },
        };
        return;
      }
      if (code !== 0) {
        yield {
          type: 'invocation.failed',
          error: {
            code: 'CURSOR_AGENT_EXIT',
            message: stderr.trim().slice(0, 600) || `Cursor Agent exit ${code}`,
            retryable: true,
          },
        };
        return;
      }
      yield { type: 'invocation.completed', output: { mode: 'cursor-agent' } };
      return;
    }

    yield {
      type: 'invocation.failed',
      error: {
        code: 'CURSOR_AGENT_MISSING',
        message:
          'Cursor Agent CLI is required for live writer turns; no filesystem fallback was used.',
        retryable: false,
      },
    };
  }
}
