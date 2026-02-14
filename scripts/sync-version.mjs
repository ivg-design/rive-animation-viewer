#!/usr/bin/env node
/**
 * Sync version script
 * Pulls latest from remote and checks if versions are synchronized
 * Usage: node scripts/sync-version.mjs
 */

import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const root = process.cwd();

async function getCurrentVersions() {
  const pkgPath = path.join(root, 'package.json');
  const tauriPath = path.join(root, 'src-tauri', 'tauri.conf.json');
  const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');

  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  const tauri = JSON.parse(await fs.readFile(tauriPath, 'utf8'));
  const cargoContent = await fs.readFile(cargoPath, 'utf8');
  const cargoVersion = cargoContent.match(/^version = "([^"]+)"$/m)?.[1];

  return {
    package: pkg.version,
    tauri: tauri.version,
    cargo: cargoVersion
  };
}

async function main() {
  console.log('🔄 Syncing with remote...\n');

  // Pull latest changes
  try {
    const { stdout } = await execAsync('git pull origin main');
    console.log(stdout);
  } catch (error) {
    console.error('❌ Failed to pull:', error.message);
    process.exit(1);
  }

  // Check versions
  const versions = await getCurrentVersions();

  console.log('📦 Current versions:');
  console.log(`  package.json: ${versions.package}`);
  console.log(`  tauri.conf.json: ${versions.tauri}`);
  console.log(`  Cargo.toml: ${versions.cargo}`);

  // Verify sync
  if (versions.package === versions.tauri && versions.package === versions.cargo) {
    console.log('\n✅ All versions synchronized!');
  } else {
    console.log('\n⚠️  Version mismatch detected!');
    console.log('   Run: node scripts/bump-version.mjs patch');
    process.exit(1);
  }

  // Update Cargo.lock if needed
  try {
    console.log('\n🔧 Updating Cargo.lock...');
    await execAsync('cd src-tauri && cargo update --workspace');
    console.log('✅ Cargo.lock updated');
  } catch (error) {
    console.log('⚠️  Cargo update failed (this is usually fine)');
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
