import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import { realpath } from 'node:fs/promises';

const exec = promisify(execFile);

export class DirectoryPickerCancelled extends Error {
  constructor() {
    super('Directory selection cancelled');
    this.name = 'DirectoryPickerCancelled';
  }
}

/**
 * Opens a native OS folder picker and returns an absolute path.
 * Browser cannot expose absolute filesystem paths safely; the local
 * daemon owns the dialog so RoleFlock can register real Git repos.
 */
export async function chooseDirectory(prompt = 'Select a Git repository'): Promise<string> {
  const os = platform();
  let selected: string | undefined;

  if (os === 'darwin') {
    selected = await chooseDirectoryMac(prompt);
  } else if (os === 'win32') {
    selected = await chooseDirectoryWindows(prompt);
  } else {
    selected = await chooseDirectoryLinux(prompt);
  }

  if (!selected) throw new DirectoryPickerCancelled();
  return realpath(selected);
}

async function chooseDirectoryMac(prompt: string): Promise<string | undefined> {
  const script = [
    `try`,
    `  set chosenFolder to choose folder with prompt ${appleScriptString(prompt)}`,
    `  return POSIX path of chosenFolder`,
    `on error number -128`,
    `  return ""`,
    `end try`,
  ].join('\n');

  try {
    const { stdout } = await exec('osascript', ['-e', script], { timeout: 300_000 });
    const path = stdout.trim().replace(/\/$/, '');
    return path || undefined;
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    // User cancel often surfaces as non-zero; empty stdout means cancel.
    if (!err.stdout?.trim()) return undefined;
    throw error;
  }
}

async function chooseDirectoryWindows(_prompt: string): Promise<string | undefined> {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$dialog.Description = "Select a Git repository"',
    '$dialog.ShowNewFolderButton = $false',
    'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  Write-Output $dialog.SelectedPath',
    '}',
  ].join('; ');

  const { stdout } = await exec(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 300_000 },
  );
  const path = stdout.trim();
  return path || undefined;
}

async function chooseDirectoryLinux(prompt: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec(
      'zenity',
      ['--file-selection', '--directory', `--title=${prompt}`],
      { timeout: 300_000 },
    );
    const path = stdout.trim();
    return path || undefined;
  } catch (zenityError) {
    const code = (zenityError as { code?: number }).code;
    if (code === 1) return undefined; // cancel
    try {
      const { stdout } = await exec(
        'kdialog',
        ['--getexistingdirectory', `${process.env.HOME ?? '/'}`],
        { timeout: 300_000 },
      );
      const path = stdout.trim();
      return path || undefined;
    } catch {
      throw new Error(
        'No native folder dialog available. Install zenity or kdialog, or paste an absolute path.',
      );
    }
  }
}

function appleScriptString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** Reveal a folder in Finder / Explorer / file manager. */
export async function openDirectory(path: string): Promise<void> {
  const resolved = await realpath(path);
  const os = platform();
  if (os === 'darwin') {
    await exec('open', [resolved]);
    return;
  }
  if (os === 'win32') {
    await exec('explorer.exe', [resolved]);
    return;
  }
  await exec('xdg-open', [resolved]);
}
