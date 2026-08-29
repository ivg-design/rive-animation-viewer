#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const child = spawn(process.execPath, [
  viteBin,
  '--host', '0.0.0.0',
  '--port', '1421',
  '--strictPort',
], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    APP_BUILD_CHANNEL: 'dev',
    VITE_RAV_MCP_PORT: '9278',
  },
});

child.on('error', (error) => {
  console.error(`Failed to start the isolated DEV server: ${error.message}`);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
