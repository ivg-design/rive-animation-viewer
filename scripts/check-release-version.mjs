#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.cwd();

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function matchVersion(content, pattern, label) {
  const version = content.match(pattern)?.[1];
  if (!version) {
    throw new Error(`Could not resolve ${label}`);
  }
  return version;
}

export function collectVersions() {
  const packageJson = readJson('package.json');
  const packageLock = readJson('package-lock.json');
  const tauriConfig = readJson('src-tauri/tauri.conf.json');
  const cargoToml = read('src-tauri/Cargo.toml');
  const cargoLock = read('src-tauri/Cargo.lock');
  const websiteLayout = read('web/src/app/layout.tsx');

  return {
    'package.json': packageJson.version,
    'package-lock.json': packageLock.version,
    'package-lock.json packages[""]': packageLock.packages?.['']?.version,
    'src-tauri/tauri.conf.json': tauriConfig.version,
    'src-tauri/Cargo.toml': matchVersion(
      cargoToml,
      /^\[package\][\s\S]*?^version = "([^"]+)"/m,
      'src-tauri/Cargo.toml package version',
    ),
    'src-tauri/Cargo.lock app package': matchVersion(
      cargoLock,
      /\[\[package\]\]\nname = "app"\nversion = "([^"]+)"/,
      'src-tauri/Cargo.lock app package version',
    ),
    'web/src/app/layout.tsx': matchVersion(
      websiteLayout,
      /softwareVersion: "([^"]+)"/,
      'website softwareVersion',
    ),
  };
}

function requireReleaseContent(version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const changelogHeading = new RegExp(`^## \\[${escapedVersion}\\](?: - .+)?$`, 'm');
  const readmeCurrentRelease = new RegExp(
    `^- Current release: \`${escapedVersion}\`(?: \\(.+\\))?$`,
    'm',
  );

  const checks = [
    ['CHANGELOG.md', changelogHeading],
    ['web/CHANGELOG.md', changelogHeading],
    ['README.md current release', readmeCurrentRelease, read('README.md')],
  ];

  const missing = checks
    .filter(([file, pattern, suppliedContent]) => {
      const content = suppliedContent ?? read(file);
      return !pattern.test(content);
    })
    .map(([label]) => label);

  if (missing.length > 0) {
    throw new Error(`Release ${version} is missing from: ${missing.join(', ')}`);
  }
}

export function verifyReleaseVersion({ expectedVersion, requireReleaseNotes = false } = {}) {
  const versions = collectVersions();
  const canonicalVersion = expectedVersion || versions['package.json'];
  const mismatches = Object.entries(versions)
    .filter(([, version]) => version !== canonicalVersion)
    .map(([source, version]) => `${source}=${version ?? '<missing>'}`);

  if (mismatches.length > 0) {
    throw new Error(
      `Expected version ${canonicalVersion}, but found mismatches:\n- ${mismatches.join('\n- ')}`,
    );
  }

  if (requireReleaseNotes) {
    requireReleaseContent(canonicalVersion);
  }

  return { version: canonicalVersion, sources: versions };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = verifyReleaseVersion({
    expectedVersion: args.version,
    requireReleaseNotes: Boolean(args['require-release-notes']),
  });
  console.log(`Release version ${result.version} is synchronized across all product metadata.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
