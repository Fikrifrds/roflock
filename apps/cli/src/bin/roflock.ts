#!/usr/bin/env node
import { runCli } from '../main.js';

process.exitCode = runCli(process.argv.slice(2), {
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`),
});
