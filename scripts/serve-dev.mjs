#!/usr/bin/env node
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = portIndex >= 0 ? Number.parseInt(args[portIndex + 1] || '', 10) : 1421;
const open = args.includes('--open');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Usage: node scripts/serve-dev.mjs [--port <1-65535>] [--open]');
  process.exit(2);
}

const child = spawn(process.execPath, [
  viteBin,
  '--host', '0.0.0.0',
  '--port', String(port),
  '--strictPort',
  ...(open ? ['--open'] : []),
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
