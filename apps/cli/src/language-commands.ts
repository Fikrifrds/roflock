import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import {
  formatDiagnostic,
  isExecutable,
  normalizeIR,
  semanticHash,
  validateGraphIR,
  type Diagnostic,
  type GraphIR,
} from '@roleflock/graph-ir';
import { compile } from '@roleflock/language';
import { ExitCode } from './exit-codes.js';
import type { CliIo } from './main.js';

/**
 * `roflock check`, `compile`, `validate-ir` and `hash`.
 *
 * All four are pure compiler-side operations: they read a file, analyse it, and
 * write a result. None of them starts a run, spawns a provider, or touches a
 * repository, which is what makes them safe to point at an untrusted workflow.
 */

interface Parsed {
  file: string;
  out?: string;
}

function parseArgs(args: string[], command: string): Parsed {
  const positional: string[] = [];
  let out: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === '-o' || arg === '--out') {
      out = args[i + 1];
      if (out === undefined) throw new UsageError(`${arg} needs a file path`);
      i += 1;
    } else if (arg.startsWith('-')) throw new UsageError(`Unknown option '${arg}'`);
    else positional.push(arg);
  }

  const file = positional[0];
  if (file === undefined) throw new UsageError(`Usage: roflock ${command} <file>`);
  if (positional.length > 1) throw new UsageError(`roflock ${command} takes one file`);

  return { file, ...(out === undefined ? {} : { out }) };
}

class UsageError extends Error {}

function read(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new UsageError(`Cannot read '${path}'`);
  }
}

function report(diagnostics: readonly Diagnostic[], uri: string, io: CliIo): void {
  for (const diagnostic of diagnostics) {
    const line = formatDiagnostic(diagnostic, uri);
    // Errors and warnings go to stderr so `roflock compile -o -` style piping of
    // stdout stays parseable.
    if (diagnostic.severity === 'info') io.stdout(line);
    else io.stderr(line);
  }
}

function summarise(diagnostics: readonly Diagnostic[]): string {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length;
  const parts: string[] = [];
  if (errors) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  return parts.join(', ');
}

export function runCheck(args: string[], io: CliIo): number {
  let parsed: Parsed;
  try {
    parsed = parseArgs(args, 'check');
  } catch (caught) {
    io.stderr((caught as Error).message);
    return ExitCode.Usage;
  }

  let source: string;
  try {
    source = read(parsed.file);
  } catch (caught) {
    io.stderr((caught as Error).message);
    return ExitCode.Config;
  }

  const result = compile(source, { uri: relative(process.cwd(), parsed.file) || parsed.file });
  report(result.diagnostics, parsed.file, io);

  if (!isExecutable(result.diagnostics) || !result.ir) {
    io.stderr(`${parsed.file}: ${summarise(result.diagnostics)}`);
    return ExitCode.Usage;
  }

  const suffix = summarise(result.diagnostics);
  io.stdout(
    `${parsed.file}: ok — ${result.ir.nodes.length} nodes, ${result.ir.edges.length} edges, ${result.ir.loops.length} loop${result.ir.loops.length === 1 ? '' : 's'}${suffix ? ` (${suffix})` : ''}`,
  );
  io.stdout(result.ir.workflow.semanticHash ?? '');
  return ExitCode.Ok;
}

export function runCompile(args: string[], io: CliIo): number {
  let parsed: Parsed;
  try {
    parsed = parseArgs(args, 'compile');
  } catch (caught) {
    io.stderr((caught as Error).message);
    return ExitCode.Usage;
  }

  let source: string;
  try {
    source = read(parsed.file);
  } catch (caught) {
    io.stderr((caught as Error).message);
    return ExitCode.Config;
  }

  const result = compile(source, { uri: relative(process.cwd(), parsed.file) || parsed.file });
  report(result.diagnostics, parsed.file, io);
  if (!result.ir) return ExitCode.Usage;

  const json = `${JSON.stringify(normalizeIR(result.ir), null, 2)}\n`;
  if (parsed.out === undefined) {
    io.stdout(json.trimEnd());
    return ExitCode.Ok;
  }

  try {
    writeFileSync(parsed.out, json);
  } catch {
    io.stderr(`Cannot write '${parsed.out}'`);
    return ExitCode.Config;
  }
  io.stderr(`Wrote ${parsed.out}`);
  return ExitCode.Ok;
}

export function runValidateIr(args: string[], io: CliIo): number {
  let parsed: Parsed;
  try {
    parsed = parseArgs(args, 'validate-ir');
  } catch (caught) {
    io.stderr((caught as Error).message);
    return ExitCode.Usage;
  }

  let document: GraphIR;
  try {
    document = JSON.parse(read(parsed.file)) as GraphIR;
  } catch (caught) {
    io.stderr(caught instanceof UsageError ? caught.message : `'${parsed.file}' is not valid JSON`);
    return caught instanceof UsageError ? ExitCode.Config : ExitCode.Usage;
  }

  const diagnostics = validateGraphIR(document);
  report(diagnostics, parsed.file, io);
  if (!isExecutable(diagnostics)) {
    io.stderr(`${parsed.file}: ${summarise(diagnostics)}`);
    return ExitCode.Usage;
  }

  // A stamped hash that no longer matches means the document was edited after
  // it was produced, so a run claiming that identity would be describing a
  // different graph.
  const stamped = document.workflow.semanticHash;
  const actual = semanticHash(document);
  if (stamped !== undefined && stamped !== actual) {
    io.stderr(
      `${parsed.file}: stamped semantic hash ${stamped} does not match its content (${actual})`,
    );
    return ExitCode.Usage;
  }

  io.stdout(`${parsed.file}: ok`);
  io.stdout(actual);
  return ExitCode.Ok;
}

export function runHash(args: string[], io: CliIo): number {
  let parsed: Parsed;
  try {
    parsed = parseArgs(args, 'hash');
  } catch (caught) {
    io.stderr((caught as Error).message);
    return ExitCode.Usage;
  }

  let source: string;
  try {
    source = read(parsed.file);
  } catch (caught) {
    io.stderr((caught as Error).message);
    return ExitCode.Config;
  }

  if (parsed.file.endsWith('.json')) {
    try {
      io.stdout(semanticHash(JSON.parse(source) as GraphIR));
      return ExitCode.Ok;
    } catch {
      io.stderr(`'${parsed.file}' is not valid JSON`);
      return ExitCode.Usage;
    }
  }

  const result = compile(source, { uri: parsed.file });
  if (!result.ir) {
    report(result.diagnostics, parsed.file, io);
    return ExitCode.Usage;
  }
  io.stdout(result.ir.workflow.semanticHash ?? semanticHash(result.ir));
  return ExitCode.Ok;
}
