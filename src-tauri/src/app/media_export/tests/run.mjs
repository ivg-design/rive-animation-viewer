#!/usr/bin/env node
import { existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifest = path.join(directory, 'Cargo.toml');
const nestedTarget = path.join(directory, 'target');
const targetDirectory = path.resolve(directory, '../../../..', 'target-media-harness');
const allowed = new Set(['test', 'check', 'clippy']);

const requested = process.argv.slice(2);
const command = requested[0] && allowed.has(requested[0]) ? requested.shift() : 'test';
rmSync(nestedTarget, { recursive: true, force: true });

const result = spawnSync('cargo', [command, '--manifest-path', manifest, ...requested], {
    cwd: directory,
    env: { ...process.env, CARGO_TARGET_DIR: targetDirectory },
    stdio: 'inherit',
});

if (existsSync(nestedTarget)) {
    rmSync(nestedTarget, { recursive: true, force: true });
    console.error(`Harness hygiene failure: Cargo wrote nested output to ${nestedTarget}`);
    process.exit(1);
}
if (result.error) {
    console.error(`Unable to run Cargo: ${result.error.message}`);
    process.exit(1);
}
process.exit(result.status ?? 1);
