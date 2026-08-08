#!/usr/bin/env node
import { runCliAsync } from '../main.js';

process.exitCode = await runCliAsync(process.argv.slice(2), {
  stdout: (message) => process.stdout.write(`${message}\n`),
  stderr: (message) => process.stderr.write(`${message}\n`),
});
