#!/usr/bin/env node
/**
 * Bump version script
 * Increments version number across product metadata files.
 * Release notes and README highlights remain intentional manual edits.
 * Usage: node scripts/bump-version.mjs [major|minor|patch]
 */

import { promises as fs } from 'fs';
import path from 'path';

const root = process.cwd();

function replaceExactlyOnce(content, pattern, replacement, label) {
  let replacements = 0;
  const updated = content.replace(pattern, (...args) => {
    replacements += 1;
    return typeof replacement === 'function' ? replacement(...args) : replacement;
  });
  if (replacements !== 1) {
    throw new Error(`Expected exactly one ${label}; found ${replacements}`);
  }
  return updated;
}

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
  for (const relativePath of ['package.json', 'package-lock.json']) {
    const filePath = path.join(root, relativePath);
    const json = JSON.parse(await fs.readFile(filePath, 'utf8'));
    json.version = newVersion;
    if (relativePath === 'package-lock.json' && json.packages?.['']) {
      json.packages[''].version = newVersion;
    }
    await fs.writeFile(filePath, `${JSON.stringify(json, null, 2)}\n`);
    console.log(`✓ Updated ${relativePath}: ${newVersion}`);
  }
}

async function updateTauriConfig(newVersion) {
  for (const relativePath of ['tauri.conf.json', 'tauri.flicker-test.conf.json']) {
    const configPath = path.join(root, 'src-tauri', relativePath);
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    if (typeof config.version !== 'string') {
      throw new Error(`${relativePath} does not contain a string version`);
    }
    config.version = newVersion;
    if (relativePath === 'tauri.flicker-test.conf.json') {
      config.productName = `RAV ${newVersion} DEV`;
      config.mainBinaryName = `rav-${newVersion}-dev`;
      (config.app?.windows || []).forEach((windowConfig) => {
        if (windowConfig.label === 'main') windowConfig.title = `RAV ${newVersion} DEV`;
      });
    }
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`✓ Updated ${relativePath}: ${newVersion}`);
  }
}

async function updateCargoToml(newVersion) {
  const cargoPath = path.join(root, 'src-tauri', 'Cargo.toml');
  let content = await fs.readFile(cargoPath, 'utf8');

  content = replaceExactlyOnce(
    content,
    /^version = "[\d.]+"$/m,
    `version = "${newVersion}"`,
    'Cargo.toml package version',
  );

  await fs.writeFile(cargoPath, content);
  console.log(`✓ Updated Cargo.toml: ${newVersion}`);

  const lockPath = path.join(root, 'src-tauri', 'Cargo.lock');
  let lockContent = await fs.readFile(lockPath, 'utf8');
  lockContent = replaceExactlyOnce(
    lockContent,
    /(\[\[package\]\]\nname = "app"\nversion = ")[^"]+(")/,
    (_match, prefix, suffix) => `${prefix}${newVersion}${suffix}`,
    'Cargo.lock app package version',
  );
  await fs.writeFile(lockPath, lockContent);
  console.log(`✓ Updated Cargo.lock app package: ${newVersion}`);
}

async function verifyDynamicWebsiteMetadata() {
  const layoutPath = path.join(root, 'web', 'src', 'app', 'layout.tsx');
  const content = await fs.readFile(layoutPath, 'utf8');
  const requiredFragments = [
    'const latestPublicRelease = await getLatestRelease();',
    'softwareVersion: latestPublicRelease.version',
    'dateModified: latestPublicRelease.date',
  ];
  const missing = requiredFragments.filter((fragment) => !content.includes(fragment));
  if (missing.length > 0) {
    throw new Error(
      `Website JSON-LD must dynamically derive public release metadata; missing: ${missing.join(', ')}`,
    );
  }
  console.log('✓ Website software metadata dynamically follows GitHub\'s latest public release');
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
  await verifyDynamicWebsiteMetadata();

  console.log(`\n✓ Product version metadata updated to ${newVersion}`);
  console.log('  Add matching CHANGELOG and README release content before publishing.');
  console.log(`\nNext steps:`);
  console.log(`  node scripts/check-release-version.mjs --version ${newVersion} --require-release-notes`);
  console.log(`  git commit -m "chore(release): v${newVersion}"`);
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
