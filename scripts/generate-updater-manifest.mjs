#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
      continue;
    }
    result[key] = next;
    i += 1;
  }
  return result;
}

function normalizeArch(name) {
  if (!name) return null;
  if (name === 'x64' || name === 'x86_64') return 'x86_64';
  if (name === 'arm64' || name === 'aarch64') return 'aarch64';
  return name;
}

function findArch(assetName) {
  const match = assetName.match(/(?:_|-)(aarch64|arm64|x86_64|x64)(?=[._-])/i);
  return normalizeArch(match?.[1]?.toLowerCase() || null);
}

function findSignatureMap(assets) {
  const map = new Map();
  for (const asset of assets) {
    if (!asset?.name?.endsWith('.sig')) continue;
    const baseName = asset.name.slice(0, -4);
    map.set(baseName, asset);
  }
  return map;
}

function buildPlatformEntry(asset, signatureAsset) {
  if (!asset || !signatureAsset) return null;
  return {
    signature: fs.readFileSync(signatureAsset.localPath, 'utf8').trim(),
    url: asset.downloadUrl,
  };
}

function sortKeys(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const releaseFile = args['release-file'];
  const signatureDir = args['signature-dir'];
  const output = args.output;

  if (!releaseFile || !signatureDir || !output) {
    throw new Error('Usage: generate-updater-manifest --release-file <json> --signature-dir <dir> --output <file>');
  }

  const release = JSON.parse(fs.readFileSync(releaseFile, 'utf8'));
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const signatures = findSignatureMap(assets);
  const platforms = {};

  for (const asset of assets) {
    const name = asset?.name || '';
    const arch = findArch(name);
    if (!arch) continue;

    if (name.endsWith('.app.tar.gz')) {
      const signatureAsset = signatures.get(name);
      if (!signatureAsset) continue;
      const signaturePath = path.join(signatureDir, signatureAsset.name);
      if (!fs.existsSync(signaturePath)) continue;
      const entry = buildPlatformEntry(
        { downloadUrl: asset.url, name },
        { localPath: signaturePath, name: signatureAsset.name },
      );
      if (!entry) continue;
      platforms[`darwin-${arch}`] = entry;
      platforms[`darwin-${arch}-app`] = entry;
      continue;
    }

    if (
      name.endsWith('.msi')
      || name.endsWith('.msi.zip')
      || name.endsWith('-setup.exe')
      || name.endsWith('.exe.zip')
    ) {
      const signatureAsset = signatures.get(name);
      if (!signatureAsset) continue;
      const signaturePath = path.join(signatureDir, signatureAsset.name);
      if (!fs.existsSync(signaturePath)) continue;
      const entry = buildPlatformEntry(
        { downloadUrl: asset.url, name },
        { localPath: signaturePath, name: signatureAsset.name },
      );
      if (!entry) continue;
      const installerKey = (name.endsWith('.msi') || name.endsWith('.msi.zip')) ? 'msi' : 'nsis';
      platforms[`windows-${arch}-${installerKey}`] = entry;
      if (installerKey === 'msi' || !platforms[`windows-${arch}`]) {
        platforms[`windows-${arch}`] = entry;
      }
    }
  }

  if (Object.keys(platforms).length === 0) {
    throw new Error('No updater platforms were resolved from the release assets');
  }

  const manifest = {
    version: release.tagName?.replace(/^v/, '') || release.version,
    notes: release.body || '',
    pub_date: release.publishedAt || new Date().toISOString(),
    platforms: sortKeys(platforms),
  };

  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
}

main();
