import { ExitCode } from './exit-codes.js';
import type { CliIo } from './main.js';
import { emitUsageError } from './runtime-output.js';

const COMMANDS = [
  'check',
  'compile',
  'render',
  'hash',
  'validate-ir',
  'explain',
  'dry-run',
  'run',
  'status',
  'events',
  'logs',
  'pause',
  'resume',
  'cancel',
  'approvals',
  'approval',
  'approve',
  'reject',
  'accept-task',
  'reject-task',
  'studio',
  'daemon',
  'init',
  'doctor',
  'drivers',
  'evidence',
  'why',
  'passport',
  'completion',
  'help',
  'version',
];

function bash(): string {
  return `# Roflock completion for Bash\n_roflock() {\n  local cur="${'$'}{COMP_WORDS[COMP_CWORD]}"\n  COMPREPLY=( $(compgen -W "${COMMANDS.join(' ')}" -- "${'$'}cur") )\n}\ncomplete -F _roflock roflock roleflock\n`;
}

function zsh(): string {
  return `#compdef roflock roleflock\n_roflock() {\n  local -a commands\n  commands=(${COMMANDS.map((command) => `'${command}:${command}'`).join(' ')})\n  _describe 'roflock command' commands\n}\ncompdef _roflock roflock roleflock\n`;
}

function fish(): string {
  return `# Roflock completion for Fish\ncomplete -c roflock -f -a "${COMMANDS.join(' ')}"\ncomplete -c roleflock -f -a "${COMMANDS.join(' ')}"\n`;
}

export function runCompletion(args: string[], io: CliIo): number {
  if (args.length !== 1 || !['bash', 'zsh', 'fish'].includes(args[0]!)) {
    return emitUsageError('Usage: roflock completion <bash|zsh|fish>', args, io);
  }
  io.stdout(args[0] === 'bash' ? bash() : args[0] === 'zsh' ? zsh() : fish());
  return ExitCode.Ok;
}
