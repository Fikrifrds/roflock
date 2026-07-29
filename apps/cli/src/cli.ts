#!/usr/bin/env node
import { runPassportCli } from './passport-command.js';

process.exitCode = runPassportCli(process.argv.slice(2), {
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`),
});
