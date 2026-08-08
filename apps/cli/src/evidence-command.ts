import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openMigratedDatabase } from '@roleflock/database';
import { explainFile, explainRun, renderExplanation } from '@roleflock/evidence';
import { ExitCode } from './exit-codes.js';
import type { CliIo } from './main.js';

/**
 * `roflock evidence <task>` and `roflock why <task> --file <path>`.
 *
 * Reads the local database directly rather than going through the daemon: the
 * question "why should I believe this change is safe?" should be answerable
 * from the record on disk, without a service being up. Evidence that needs a
 * running process to be read is evidence that disappears exactly when someone
 * most needs it.
 *
 * Read-only. Neither command starts a run or contacts a provider.
 */

/** Mirrors `resolveDataDir` in the daemon; see that file for why. */
function resolveDataDir(override?: string): string {
  const explicit = override ?? process.env['ROFLOCK_DATA_DIR'] ?? process.env['ROLEFLOCK_DATA_DIR'];
  if (explicit !== undefined && explicit !== '') return explicit;
  const current = join(homedir(), '.roflock');
  if (existsSync(current)) return current;
  const legacy = join(homedir(), '.roleflock');
  return existsSync(legacy) ? legacy : current;
}

interface Parsed {
  taskId: string;
  file?: string;
  json: boolean;
  dataDir?: string;
}

function parseArgs(args: string[], command: string): Parsed {
  const positional: string[] = [];
  let file: string | undefined;
  let dataDir: string | undefined;
  let json = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '--json') json = true;
    else if (arg === '--file') {
      file = args[i + 1];
      if (file === undefined) throw new Error('--file needs a path');
      i += 1;
    } else if (arg === '--data-dir') {
      dataDir = args[i + 1];
      if (dataDir === undefined) throw new Error('--data-dir needs a path');
      i += 1;
    } else if (arg.startsWith('-')) throw new Error(`Unknown option '${arg}'`);
    else positional.push(arg);
  }

  const taskId = positional[0];
  if (taskId === undefined) throw new Error(`Usage: roflock ${command} <task-id>`);
  return {
    taskId,
    json,
    ...(file === undefined ? {} : { file }),
    ...(dataDir === undefined ? {} : { dataDir }),
  };
}

function withDatabase<T>(
  dataDir: string,
  body: (db: ReturnType<typeof openMigratedDatabase>) => T,
): T {
  const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
  try {
    return body(db);
  } finally {
    db.close();
  }
}

export function runEvidence(args: string[], io: CliIo): number {
  let parsed: Parsed;
  try {
    parsed = parseArgs(args, 'evidence');
  } catch (caught) {
    io.stderr((caught as Error).message);
    return ExitCode.Usage;
  }

  const dataDir = resolveDataDir(parsed.dataDir);
  if (!existsSync(join(dataDir, 'roleflock.db'))) {
    io.stderr(`No Roflock database at ${dataDir}. Set ROFLOCK_DATA_DIR or pass --data-dir.`);
    return ExitCode.Config;
  }

  const explanation = withDatabase(dataDir, (db) => explainRun(db, parsed.taskId));

  if (parsed.json) {
    io.stdout(JSON.stringify(explanation, null, 2));
  } else {
    io.stdout(renderExplanation(explanation));
  }

  // A run whose chain has holes is not a failure of this command — it is the
  // answer. Exit 0 and let the reader judge; the gaps are named in the output.
  return ExitCode.Ok;
}

export function runWhy(args: string[], io: CliIo): number {
  let parsed: Parsed;
  try {
    parsed = parseArgs(args, 'why');
  } catch (caught) {
    io.stderr((caught as Error).message);
    return ExitCode.Usage;
  }

  if (parsed.file === undefined) {
    io.stderr('Usage: roflock why <task-id> --file <path>');
    return ExitCode.Usage;
  }

  const dataDir = resolveDataDir(parsed.dataDir);
  if (!existsSync(join(dataDir, 'roleflock.db'))) {
    io.stderr(`No Roflock database at ${dataDir}. Set ROFLOCK_DATA_DIR or pass --data-dir.`);
    return ExitCode.Config;
  }

  const file = parsed.file;
  const touched = withDatabase(dataDir, (db) => explainFile(db, parsed.taskId, file));

  if (parsed.json) {
    io.stdout(JSON.stringify({ taskId: parsed.taskId, file, artefacts: touched }, null, 2));
    return ExitCode.Ok;
  }

  if (touched.length === 0) {
    // Says what it knows, not what it guesses: no recorded artefact mentions
    // this path, which is different from the file having no history.
    io.stdout(`No recorded output for ${file} under task ${parsed.taskId}.`);
    return ExitCode.Ok;
  }

  io.stdout(`${file} under task ${parsed.taskId}:`);
  for (const artefact of touched) {
    io.stdout(`  ${artefact.createdAt}  ${artefact.kind}  ${artefact.hash ?? '(no hash)'}`);
  }
  return ExitCode.Ok;
}
