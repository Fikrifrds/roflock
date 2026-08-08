/**
 * Environment variable resolution across the RoleFlock → Roflock rename.
 *
 * Every setting is read as `ROFLOCK_<NAME>` first and falls back to the legacy
 * `ROLEFLOCK_<NAME>`, so an existing local installation keeps working after an
 * upgrade and a fresh one only ever sees the new spelling.
 *
 * The fallback triggers on *undefined only*, never on an empty value. Setting
 * `ROFLOCK_FORCE_FAKE=` is an explicit instruction to turn something off; if an
 * empty value fell through to a stale `ROLEFLOCK_FORCE_FAKE=1` the operator
 * would silently get the opposite of what they asked for. That matters most for
 * the secret-bearing variables, where falling back to a stale value is a
 * security problem rather than a papercut.
 */

const ROFLOCK_PREFIX = 'ROFLOCK_';
const LEGACY_PREFIX = 'ROLEFLOCK_';

/** One notice per variable per process — enough to be noticed, not spam. */
const announced = new Set<string>();

export interface EnvOptions {
  env?: NodeJS.ProcessEnv;
  /** Where the deprecation notice goes. Defaults to stderr; pass a sink in tests. */
  warn?: (message: string) => void;
}

/**
 * Reads `ROFLOCK_<name>`, falling back to the legacy `ROLEFLOCK_<name>` and
 * warning once when the legacy spelling is what supplied the value.
 *
 * @param name variable name without a prefix, e.g. `DATA_DIR`
 */
export function readEnv(name: string, options: EnvOptions = {}): string | undefined {
  const env = options.env ?? process.env;
  const current = env[`${ROFLOCK_PREFIX}${name}`];
  if (current !== undefined) return current;

  const legacy = env[`${LEGACY_PREFIX}${name}`];
  if (legacy === undefined) return undefined;

  if (!announced.has(name)) {
    announced.add(name);
    const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`));
    warn(
      `warning: ${LEGACY_PREFIX}${name} is deprecated and will be removed in a future release. Use ${ROFLOCK_PREFIX}${name} instead.`,
    );
  }
  return legacy;
}

/**
 * Both spellings of a variable Roflock *sets* for a child process.
 *
 * Handoff scripts, verification commands and repository hooks that users have
 * already written read the legacy names, so during the transition a child sees
 * both. Removing the legacy half is a separate, breaking decision.
 */
export function exportedEnvNames(name: string): [string, string] {
  return [`${ROFLOCK_PREFIX}${name}`, `${LEGACY_PREFIX}${name}`];
}

/** Assigns a value under both the current and legacy names. */
export function withLegacyAlias(
  target: NodeJS.ProcessEnv,
  name: string,
  value: string,
): NodeJS.ProcessEnv {
  const [current, legacy] = exportedEnvNames(name);
  target[current] = value;
  target[legacy] = value;
  return target;
}

/** Test seam: forget which deprecation notices have already been emitted. */
export function resetEnvDeprecationNotices(): void {
  announced.clear();
}
