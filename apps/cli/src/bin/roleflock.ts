#!/usr/bin/env node
/**
 * Legacy executable name. The product is Roflock, but an existing local install
 * has `roleflock` on its PATH and scripts may invoke it, so the old name keeps
 * working and only warns. The notice goes to stderr so it cannot corrupt piped
 * stdout, and the exit code is whatever `roflock` itself returned.
 */
import { runCliAsync } from '../main.js';

process.stderr.write(
  "warning: 'roleflock' is the legacy command name and will be removed in a future release. Use 'roflock' instead.\n",
);

process.exitCode = await runCliAsync(process.argv.slice(2), {
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`),
});
