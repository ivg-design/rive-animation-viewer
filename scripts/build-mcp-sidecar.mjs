#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import './generate-media-tools.mjs';

const root = process.cwd();
const tauriDir = path.join(root, 'src-tauri');
const targetTriple = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CARGO_BUILD_TARGET || '';
const isWindowsTarget = (targetTriple || process.platform).includes('windows') || process.platform === 'win32';
const binaryName = isWindowsTarget ? 'rav-mcp.exe' : 'rav-mcp';
const isDebug = process.argv.includes('--debug');
const profile = isDebug ? 'debug' : 'release';

const cargoArgs = [
  'build',
  '--locked',
  '--manifest-path',
  path.join('src-tauri', 'Cargo.toml'),
  '--bin',
  'rav-mcp',
];
if (!isDebug) {
  cargoArgs.push('--release');
}
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
  ? path.join(tauriDir, 'target', targetTriple, profile, binaryName)
  : path.join(tauriDir, 'target', profile, binaryName);

if (!existsSync(sourceBinary)) {
  console.error(`rav-mcp binary not found at ${sourceBinary}`);
  process.exit(1);
}

console.log(`Built MCP sidecar at ${path.relative(root, sourceBinary)}`);
