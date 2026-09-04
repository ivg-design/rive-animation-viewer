#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function runNodeScript(script, env = process.env) {
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runNodeScript('scripts/generate-media-tools.mjs');
runNodeScript('scripts/generate-snippet-modules.mjs');
runNodeScript('scripts/build-dist.mjs', {
  ...process.env,
  APP_BUILD_CHANNEL: 'dev',
  APP_DIST_DIR: 'dist-dev',
});
