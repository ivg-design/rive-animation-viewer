#!/usr/bin/env node
import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tauriDir = path.join(root, 'src-tauri');
const resourcesDir = path.join(tauriDir, 'resources');
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || '';
const isWindowsTarget = (targetTriple || process.platform).includes('windows') || process.platform === 'win32';
const binaryName = isWindowsTarget ? 'rav-mcp.exe' : 'rav-mcp';

mkdirSync(resourcesDir, { recursive: true });

const cargoArgs = ['build', '--manifest-path', path.join('src-tauri', 'Cargo.toml'), '--bin', 'rav-mcp', '--release'];
if (targetTriple) {
  cargoArgs.push('--target', targetTriple);
}

const build = spawnSync('cargo', cargoArgs, {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const sourceBinary = targetTriple
  ? path.join(tauriDir, 'target', targetTriple, 'release', binaryName)
  : path.join(tauriDir, 'target', 'release', binaryName);

if (!existsSync(sourceBinary)) {
  console.error(`rav-mcp binary not found at ${sourceBinary}`);
  process.exit(1);
}

const destinationBinary = path.join(resourcesDir, binaryName);
copyFileSync(sourceBinary, destinationBinary);

if (!isWindowsTarget) {
  chmodSync(destinationBinary, 0o755);
}

console.log(`Built MCP sidecar to ${path.relative(root, destinationBinary)}`);
