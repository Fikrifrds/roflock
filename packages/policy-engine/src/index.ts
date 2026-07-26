import { relative, resolve } from 'node:path';
export interface Policy { allowedPathGlobs?: string[]; deniedPathGlobs?: string[]; allowedCommands?: string[]; deniedCommands?: string[]; }
function glob(value: string, pattern: string) { return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '§').replace(/\*/g, '[^/]*').replace(/§/g, '.*')}$`).test(value); }
export function checkPath(policy: Policy, root: string, path: string): { allowed: boolean; reason?: string } {
  const normal = relative(root, resolve(root, path)); if (!normal || normal.startsWith('..')) return { allowed: false, reason: 'path escapes root' };
  if (policy.deniedPathGlobs?.some((p) => glob(normal, p))) return { allowed: false, reason: 'denied path pattern' };
  if (policy.allowedPathGlobs && !policy.allowedPathGlobs.some((p) => glob(normal, p))) return { allowed: false, reason: 'not an allowed path pattern' };
  return { allowed: true };
}
export function checkCommand(policy: Policy, command: string, args: string[] = []): { allowed: boolean; reason?: string } {
  const actual = [command, ...args].join(' '); if (policy.deniedCommands?.some((p) => glob(actual, p) || glob(command, p))) return { allowed: false, reason: 'denied command pattern' };
  if (policy.allowedCommands && !policy.allowedCommands.some((p) => glob(actual, p) || glob(command, p))) return { allowed: false, reason: 'not an allowed command pattern' };
  return { allowed: true };
}
