import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { whichBinary } from '@roleflock/provider-core';

const execFileAsync = promisify(execFile);

export interface ProviderUsageLink {
  id: string;
  label: string;
  url: string;
  hint?: string;
}

export interface ProviderAccount {
  providerId: string;
  loggedIn: boolean;
  email?: string;
  label?: string;
  authMethod?: string;
  subscriptionType?: string;
  orgName?: string;
  supportsLogin: boolean;
  supportsSwitch: boolean;
  detail?: string;
  usageLinks?: ProviderUsageLink[];
  commandHints?: {
    login: string;
    logout: string;
    switch: string;
  };
}

export interface AuthActionResult {
  ok: boolean;
  action: 'login' | 'logout' | 'switch';
  providerId: string;
  command: string;
  launched: boolean;
  detail: string;
}

/** Vendor usage dashboards — CLI has no JSON quota API for plan limits. */
export function usageLinksFor(providerId: string): ProviderUsageLink[] {
  switch (providerId) {
    case 'claude':
      return [
        {
          id: 'claude-settings-usage',
          label: 'Claude usage',
          url: 'https://claude.ai/settings/usage',
          hint: 'Plan session/week bars. Or run /usage inside an interactive claude session.',
        },
      ];
    case 'codex':
      return [
        {
          id: 'codex-usage',
          label: 'Codex usage',
          url: 'https://chatgpt.com/codex/cloud/settings/analytics#usage',
          hint: 'ChatGPT Codex plan limits (5h / week). Or run /status inside Codex CLI.',
        },
      ];
    case 'cursor':
      return [
        {
          id: 'cursor-spending',
          label: 'Cursor spending',
          url: 'https://cursor.com/dashboard/spending',
          hint: 'Cursor plan usage and spending dashboard.',
        },
      ];
    default:
      return [];
  }
}

/** Read Claude / Codex / Cursor account state without leaking secrets. */
export async function getProviderAccount(providerId: string): Promise<ProviderAccount> {
  switch (providerId) {
    case 'claude':
      return getClaudeAccount();
    case 'codex':
      return getCodexAccount();
    case 'cursor':
      return getCursorAccount();
    default:
      return {
        providerId,
        loggedIn: true,
        label: 'Custom endpoint',
        supportsLogin: false,
        supportsSwitch: false,
        detail: 'Account is configured via the registered endpoint and API key.',
        usageLinks: usageLinksFor(providerId),
      };
  }
}

export async function runProviderAuthAction(
  providerId: string,
  action: 'login' | 'logout' | 'switch',
): Promise<AuthActionResult> {
  const account = await getProviderAccount(providerId);
  if (!account.supportsLogin && action !== 'logout') {
    return {
      ok: false,
      action,
      providerId,
      command: '',
      launched: false,
      detail: 'This provider does not support CLI login from RoleFlock.',
    };
  }

  if (action === 'logout' || action === 'switch') {
    const logout = await runLogout(providerId);
    if (action === 'logout') {
      return {
        ok: logout.ok,
        action,
        providerId,
        command: logout.command,
        launched: false,
        detail: logout.detail,
      };
    }
  }

  const login = await launchLogin(providerId);
  return {
    ok: login.launched || Boolean(login.command),
    action,
    providerId,
    command: login.command,
    launched: login.launched,
    detail:
      action === 'switch'
        ? `Logged out previous session. ${login.detail}`
        : login.detail,
  };
}

async function getClaudeAccount(): Promise<ProviderAccount> {
  const binary = (await whichBinary(process.env.CLAUDE_PATH ?? 'claude')) ?? 'claude';
  const hints = {
    login: `${binary} auth login`,
    logout: `${binary} auth logout`,
    switch: `${binary} auth logout && ${binary} auth login`,
  };
  try {
    const { stdout } = await execFileAsync(binary, ['auth', 'status'], {
      timeout: 8_000,
      env: process.env,
    });
    const parsed = JSON.parse(stdout) as {
      loggedIn?: boolean;
      authMethod?: string;
      email?: string;
      orgName?: string;
      subscriptionType?: string;
    };
    if (!parsed.loggedIn) {
      return {
        providerId: 'claude',
        loggedIn: false,
        supportsLogin: true,
        supportsSwitch: true,
        detail: 'Not signed in to Claude CLI.',
        usageLinks: usageLinksFor('claude'),
        commandHints: hints,
      };
    }
    return {
      providerId: 'claude',
      loggedIn: true,
      email: parsed.email,
      label: parsed.email ?? parsed.orgName,
      authMethod: parsed.authMethod,
      subscriptionType: parsed.subscriptionType,
      orgName: parsed.orgName,
      supportsLogin: true,
      supportsSwitch: true,
      detail: parsed.subscriptionType
        ? `Claude ${parsed.subscriptionType} via ${parsed.authMethod ?? 'cli'}`
        : 'Signed in to Claude CLI',
      usageLinks: usageLinksFor('claude'),
      commandHints: hints,
    };
  } catch {
    const discovered = await whichBinary(process.env.CLAUDE_PATH ?? 'claude');
    return {
      providerId: 'claude',
      loggedIn: false,
      supportsLogin: Boolean(discovered),
      supportsSwitch: Boolean(discovered),
      detail: discovered
        ? 'Claude CLI found but auth status could not be read. Try Login.'
        : 'Claude CLI was not found on PATH.',
      usageLinks: usageLinksFor('claude'),
      commandHints: hints,
    };
  }
}

async function getCodexAccount(): Promise<ProviderAccount> {
  const binary = (await whichBinary(process.env.CODEX_PATH ?? 'codex')) ?? 'codex';
  const hints = {
    login: `${binary} login`,
    logout: `${binary} logout`,
    switch: `${binary} logout && ${binary} login`,
  };
  try {
    const { stdout, stderr } = await execFileAsync(binary, ['login', 'status'], {
      timeout: 8_000,
      env: process.env,
    });
    const text = `${stdout}\n${stderr}`.trim();
    const loggedIn = /logged in/i.test(text) && !/not logged in/i.test(text);
    let authMode: string | undefined;
    try {
      const raw = await readFile(join(homedir(), '.codex', 'auth.json'), 'utf8');
      const json = JSON.parse(raw) as { auth_mode?: string };
      authMode = json.auth_mode;
    } catch {
      authMode = undefined;
    }
    if (!loggedIn) {
      return {
        providerId: 'codex',
        loggedIn: false,
        supportsLogin: true,
        supportsSwitch: true,
        detail: 'Not signed in to Codex CLI.',
        usageLinks: usageLinksFor('codex'),
        commandHints: hints,
      };
    }
    const label =
      authMode === 'chatgpt'
        ? 'ChatGPT'
        : authMode === 'api_key'
          ? 'API key'
          : text.replace(/^Logged in using\s+/i, '').trim() || 'Codex account';
    return {
      providerId: 'codex',
      loggedIn: true,
      label,
      authMethod: authMode ?? 'cli',
      supportsLogin: true,
      supportsSwitch: true,
      detail: text.split('\n').find(Boolean) ?? 'Signed in to Codex CLI',
      usageLinks: usageLinksFor('codex'),
      commandHints: hints,
    };
  } catch {
    const discovered = await whichBinary(process.env.CODEX_PATH ?? 'codex');
    return {
      providerId: 'codex',
      loggedIn: false,
      supportsLogin: Boolean(discovered),
      supportsSwitch: Boolean(discovered),
      detail: discovered
        ? 'Codex CLI found but login status could not be read. Try Login.'
        : 'Codex CLI was not found on PATH.',
      usageLinks: usageLinksFor('codex'),
      commandHints: hints,
    };
  }
}

async function getCursorAccount(): Promise<ProviderAccount> {
  const binary =
    (await whichBinary(process.env.CURSOR_PATH ?? 'cursor')) ??
    (await whichBinary('agent'));
  const hints = {
    login: 'Open Cursor → Settings → Account',
    logout: 'Open Cursor → Settings → Account → Sign out',
    switch: 'Open Cursor → Settings → Account → Sign out, then sign in',
  };
  if (!binary) {
    return {
      providerId: 'cursor',
      loggedIn: false,
      supportsLogin: false,
      supportsSwitch: false,
      detail:
        'Cursor Agent CLI was not found. Sandboxed writer still works; sign in via the Cursor app for agent features.',
      usageLinks: usageLinksFor('cursor'),
      commandHints: hints,
    };
  }
  // Cursor account is app-managed; presence of local auth files is a soft signal.
  let email: string | undefined;
  try {
    const authPath = join(homedir(), '.cursor', 'argv.json');
    await readFile(authPath, 'utf8');
  } catch {
    // ignore
  }
  try {
    const storage = join(homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage');
    // Soft presence check only — do not parse tokens.
    await readFile(join(homedir(), '.cursor', 'ide_state.json'), 'utf8').catch(() => undefined);
    void storage;
  } catch {
    // ignore
  }
  return {
    providerId: 'cursor',
    loggedIn: true,
    email,
    label: 'Cursor app account',
    authMethod: 'cursor-app',
    supportsLogin: false,
    supportsSwitch: false,
    detail: `CLI binary ready (${binary}). Switch accounts in the Cursor desktop app.`,
    usageLinks: usageLinksFor('cursor'),
    commandHints: hints,
  };
}

async function runLogout(providerId: string): Promise<{ ok: boolean; command: string; detail: string }> {
  if (providerId === 'claude') {
    const binary = (await whichBinary(process.env.CLAUDE_PATH ?? 'claude')) ?? 'claude';
    const command = `${binary} auth logout`;
    try {
      await execFileAsync(binary, ['auth', 'logout'], { timeout: 15_000, env: process.env });
      return { ok: true, command, detail: 'Signed out of Claude CLI.' };
    } catch (error) {
      return {
        ok: false,
        command,
        detail: error instanceof Error ? error.message : 'Claude logout failed',
      };
    }
  }
  if (providerId === 'codex') {
    const binary = (await whichBinary(process.env.CODEX_PATH ?? 'codex')) ?? 'codex';
    const command = `${binary} logout`;
    try {
      await execFileAsync(binary, ['logout'], { timeout: 15_000, env: process.env });
      return { ok: true, command, detail: 'Signed out of Codex CLI.' };
    } catch (error) {
      return {
        ok: false,
        command,
        detail: error instanceof Error ? error.message : 'Codex logout failed',
      };
    }
  }
  return {
    ok: false,
    command: '',
    detail: 'Logout is managed inside the Cursor app.',
  };
}

async function launchLogin(
  providerId: string,
): Promise<{ command: string; launched: boolean; detail: string }> {
  const command =
    providerId === 'claude'
      ? `${(await whichBinary(process.env.CLAUDE_PATH ?? 'claude')) ?? 'claude'} auth login`
      : providerId === 'codex'
        ? `${(await whichBinary(process.env.CODEX_PATH ?? 'codex')) ?? 'codex'} login`
        : '';
  if (!command) {
    return {
      command: 'Open Cursor → Settings → Account',
      launched: false,
      detail: 'Complete sign-in in the Cursor desktop app, then refresh Providers.',
    };
  }

  // Prefer a background process so RoleFlock does not accumulate Terminal windows.
  // Claude/Codex open the browser themselves and listen on a local callback port.
  try {
    const parts = command.split(' ');
    const bin = parts[0];
    const args = parts.slice(1);
    if (!bin) {
      return { command, launched: false, detail: `Invalid login command: ${command}` };
    }
    const child = spawn(bin, args, {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    return {
      command,
      launched: true,
      detail:
        'Login started in the background (no new Terminal window). Finish the browser flow, then refresh Providers.',
    };
  } catch {
    // fall through to Temporary Terminal on macOS
  }

  if (process.platform === 'darwin') {
    try {
      const script = `${command}; exit`;
      await execFileAsync('osascript', [
        '-e',
        `tell application "Terminal" to do script ${JSON.stringify(script)}`,
      ]);
      return {
        command,
        launched: true,
        detail:
          'Opened a temporary Terminal for CLI login (fallback). It exits when login finishes — enable Terminal → Settings → Profiles → Shell → “Close the window” when the shell exits to auto-dismiss.',
      };
    } catch (error) {
      return {
        command,
        launched: false,
        detail:
          error instanceof Error
            ? `Could not launch login. Run manually: ${command} (${error.message})`
            : `Could not launch login. Run manually: ${command}`,
      };
    }
  }

  return {
    command,
    launched: false,
    detail: `Could not launch login. Run manually in your own terminal: ${command}`,
  };
}
