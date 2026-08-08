import { readFileSync } from 'node:fs';
import { ExitCode } from './exit-codes.js';
import { runEvidence, runWhy } from './evidence-command.js';
import { runCheck, runCompile, runHash, runRender, runValidateIr } from './language-commands.js';
import { runPassportCli } from './passport-command.js';
import { runWorkflow } from './runtime-command.js';

export interface CliIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

/**
 * Resolved from the package manifest rather than a duplicated constant, so
 * `roflock --version` cannot drift from the artifact a user actually installed.
 * `src/` and `dist/` sit at the same depth, so one path works for both the
 * compiled binary and the tests.
 */
export function cliVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: string };
  return manifest.version ?? '0.0.0';
}

const HELP = `roflock — AI coding teams as code.

Usage
  roflock <command> [options]

Language
  check <file.roflock>              Compile and validate a workflow
  compile <file.roflock> [-o out]   Emit canonical Graph IR
  render <file.roflock> [-o out]    Draw the workflow as a Mermaid diagram
  hash <file>                       Print a workflow's semantic hash
  validate-ir <file.ir.json>        Validate a Graph IR document

Runtime
  run <file.roflock> --repo <path> --brief <text>
                                    Start an authored workflow on the local daemon

Evidence
  evidence <task-id>                Explain a run from what was recorded
  why <task-id> --file <path>       Which recorded output touched a file
  passport verify <passport.json>   Verify a signed Change Passport offline

Other
  help                              Show this message
  version                           Print the Roflock version

Options
  -h, --help                        Show this message
  -v, --version                     Print the Roflock version

Roflock runs entirely on your machine and never requires a Roflock Cloud
account. Language commands never start a run or touch a repository. Runtime
commands use the authenticated loopback daemon and the same governed runtime
as Studio.

Exit codes
  0 success                 4 run failed
  1 internal error          5 blocked, needs approval
  2 usage or validation     6 cancelled
  3 configuration           7 driver or provider error

Docs: https://github.com/Fikrifrds/roflock`;

/**
 * Dispatches one CLI invocation and returns the process exit code.
 *
 * Pure with respect to the process: it takes argv and an IO sink and returns a
 * number, so every branch including the failure paths is directly testable.
 */
export function runCli(argv: string[], io: CliIo): number {
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    io.stdout(HELP);
    return ExitCode.Ok;
  }

  if (command === '--version' || command === '-v' || command === 'version') {
    io.stdout(cliVersion());
    return ExitCode.Ok;
  }

  if (command === 'passport') {
    return runPassportCli([command, ...rest], io);
  }

  if (command === 'check') return runCheck(rest, io);
  if (command === 'compile') return runCompile(rest, io);
  if (command === 'hash') return runHash(rest, io);
  if (command === 'render') return runRender(rest, io);
  if (command === 'validate-ir') return runValidateIr(rest, io);
  if (command === 'evidence') return runEvidence(rest, io);
  if (command === 'why') return runWhy(rest, io);

  io.stderr(`Unknown command: ${command}`);
  io.stderr("Run 'roflock --help' to see the available commands.");
  return ExitCode.Usage;
}

/** Async entry point for commands that communicate with the local daemon. */
export async function runCliAsync(argv: string[], io: CliIo): Promise<number> {
  if (argv[0] === 'run') return runWorkflow(argv.slice(1), io);
  return runCli(argv, io);
}
