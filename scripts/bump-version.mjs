#!/usr/bin/env node
/**
 * Bump version script
 * Increments version number across all project files
 * Usage: node scripts/bump-version.mjs [major|minor|patch]
 */

import { promises as fs } from 'fs';
import path from 'path';

const root = process.cwd();

function bumpVersion(version, type) {
  const parts = version.split('.').map(Number);

  switch (type) {
    case 'major':
      return `${parts[0] + 1}.0.0`;
    case 'minor':
      return `${parts[0]}.${parts[1] + 1}.0`;
    case 'patch':
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
    default:
      throw new Error(`Invalid bump type: ${type}. Use major, minor, or patch.`);
  }
}

async function updatePackageJson(newVersion) {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  pkg.version = newVersion;
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`✓ Updated package.json: ${newVersion}`);
}

async function updateTauriConfig(newVersion) {
  const configPath = path.join(root, 'src-tauri', 'tauri.conf.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
  config.version = newVersion;
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`✓ Updated tauri.conf.json: ${newVersion}`);
}

async function updateCargoToml(newVersion) {
  const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
  let content = await fs.readFile(cargoPath, 'utf8');

  // Update version in [package] section
  content = content.replace(
    /^version = "[\d.]+"$/m,
    `version = "${newVersion}"`
  );

  await fs.writeFile(cargoPath, content);
  console.log(`✓ Updated Cargo.toml: ${newVersion}`);
}

async function getCurrentVersion() {
  const pkgPath = path.join(root, 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  return pkg.version;
}

async function main() {
  const bumpType = process.argv[2];

  if (!bumpType || !['major', 'minor', 'patch'].includes(bumpType)) {
    console.error('Usage: node scripts/bump-version.mjs [major|minor|patch]');
    process.exit(1);
  }

  const currentVersion = await getCurrentVersion();
  const newVersion = bumpVersion(currentVersion, bumpType);

  console.log(`\nBumping version: ${currentVersion} → ${newVersion} (${bumpType})\n`);

  await updatePackageJson(newVersion);
  await updateTauriConfig(newVersion);
  await updateCargoToml(newVersion);

  console.log(`\n✓ All files updated to version ${newVersion}`);
  console.log(`\nNext steps:`);
  console.log(`  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml`);
  console.log(`  git commit -m "Release version ${newVersion}"`);
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
