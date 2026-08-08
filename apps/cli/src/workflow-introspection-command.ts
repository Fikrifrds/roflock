import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { formatDiagnostic, isExecutable, type Diagnostic, type GraphIR } from '@roleflock/graph-ir';
import { compile } from '@roleflock/language';
import { ExitCode } from './exit-codes.js';
import type { CliIo } from './main.js';
import { emitUsageError } from './runtime-output.js';

interface Options {
  file: string;
  json: boolean;
}

function parse(args: string[], command: 'explain' | 'dry-run'): Options {
  const positional: string[] = [];
  let json = false;
  for (const arg of args) {
    if (arg === '--json') json = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option '${arg}'`);
    else positional.push(arg);
  }
  if (positional.length !== 1)
    throw new Error(`Usage: roflock ${command} <workflow.roflock> [--json]`);
  return { file: positional[0]!, json };
}

function diagnostics(diagnostics: readonly Diagnostic[], file: string, io: CliIo): void {
  for (const diagnostic of diagnostics) {
    const line = formatDiagnostic(diagnostic, file);
    if (diagnostic.severity === 'info') io.stdout(line);
    else io.stderr(line);
  }
}

function readAndCompile(options: Options, io: CliIo): GraphIR | undefined {
  let source: string;
  try {
    source = readFileSync(options.file, 'utf8');
  } catch {
    io.stderr(`Cannot read '${options.file}'`);
    return undefined;
  }
  const result = compile(source, { uri: relative(process.cwd(), options.file) || options.file });
  diagnostics(result.diagnostics, options.file, io);
  return isExecutable(result.diagnostics) ? result.ir : undefined;
}

function summary(ir: GraphIR) {
  const roles = ir.roles.map((role) => role.id);
  const writers = ir.nodes
    .filter((node) => node.effects?.some((effect) => effect.class === 'workspace_write'))
    .map((node) => node.id);
  const checks = ir.nodes
    .filter((node) => node.kind === 'check' && node.check.required)
    .map((node) => node.id);
  const humans = ir.nodes.filter((node) => node.kind === 'human').map((node) => node.id);
  return {
    workflow: {
      id: ir.workflow.id,
      version: ir.workflow.version,
      semanticHash: ir.workflow.semanticHash,
      description: ir.workflow.description,
    },
    roles,
    nodes: ir.nodes.map((node) => ({
      id: node.id,
      kind: node.kind,
      role: node.roleRef,
      objective: node.kind === 'agent' ? node.agent.objective : undefined,
      writer: node.effects?.some((effect) => effect.class === 'workspace_write') ?? false,
      retryBudget: node.annotations?.['roflock.coding/retry-budget'],
    })),
    edges: ir.edges.map((edge) => ({ from: edge.from, to: edge.to })),
    loops: ir.loops.map((loop) => ({
      nodeIds: loop.nodeIds,
      maxAttempts: loop.policy.maxAttempts,
    })),
    safeguards: { writers, requiredChecks: checks, humanGates: humans },
  };
}

export function runExplain(args: string[], io: CliIo): number {
  let options: Options;
  try {
    options = parse(args, 'explain');
  } catch (error) {
    return emitUsageError((error as Error).message, args, io);
  }
  const ir = readAndCompile(options, io);
  if (!ir) return ExitCode.Usage;
  const result = summary(ir);
  if (options.json) io.stdout(JSON.stringify(result));
  else {
    io.stdout(`${result.workflow.id}@${result.workflow.version}`);
    io.stdout(`Semantic hash: ${result.workflow.semanticHash}`);
    if (result.workflow.description) io.stdout(result.workflow.description);
    io.stdout(`Roles: ${result.roles.join(', ') || 'none'}`);
    io.stdout(`Nodes: ${result.nodes.map((node) => `${node.id} (${node.kind})`).join(', ')}`);
    io.stdout(`Writer: ${result.safeguards.writers.join(', ') || 'none'}`);
    io.stdout(`Required checks: ${result.safeguards.requiredChecks.join(', ') || 'none'}`);
    io.stdout(`Human gates: ${result.safeguards.humanGates.join(', ') || 'none'}`);
    io.stdout(`Bounded loops: ${result.loops.length}`);
  }
  return ExitCode.Ok;
}

/**
 * A dry run validates and describes the exact Graph IR that would be submitted
 * by `roflock run`; it never creates a project, contacts a daemon, or invokes a
 * driver. This is deliberately not a simulated execution claim.
 */
export function runDryRun(args: string[], io: CliIo): number {
  let options: Options;
  try {
    options = parse(args, 'dry-run');
  } catch (error) {
    return emitUsageError((error as Error).message, args, io);
  }
  const ir = readAndCompile(options, io);
  if (!ir) return ExitCode.Usage;
  const result = { dryRun: true, executionStarted: false, ...summary(ir) };
  if (options.json) io.stdout(JSON.stringify(result));
  else {
    io.stdout(`Dry run accepted ${result.workflow.id}@${result.workflow.version}.`);
    io.stdout(`Semantic hash: ${result.workflow.semanticHash}`);
    io.stdout(
      `${result.nodes.length} nodes, ${result.edges.length} edges, ${result.loops.length} bounded loops.`,
    );
    io.stdout('No daemon, repository, provider, command, or human approval was touched.');
  }
  return ExitCode.Ok;
}
