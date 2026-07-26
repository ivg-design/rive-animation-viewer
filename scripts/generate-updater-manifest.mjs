import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_UPDATER_PLATFORMS = [
  'darwin-aarch64',
  'darwin-aarch64-app',
  'darwin-x86_64',
  'darwin-x86_64-app',
  'windows-x86_64',
  'windows-x86_64-msi',
  'windows-x86_64-nsis',
];

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
  const signature = fs.readFileSync(signatureAsset.localPath, 'utf8').trim();
  if (!signature) return null;
  return {
    signature,
    url: asset.downloadUrl,
  };
}

export function canonicalizeAssetDownloadUrl(downloadUrl, tagName, assetName) {
  if (!downloadUrl || !tagName || !assetName) return downloadUrl;

  try {
    const url = new URL(downloadUrl);
    const marker = '/releases/download/';
    const markerIndex = url.pathname.indexOf(marker);
    if (url.hostname !== 'github.com' || markerIndex === -1) return downloadUrl;

    const repositoryPath = url.pathname.slice(0, markerIndex);
    url.pathname = `${repositoryPath}${marker}${encodeURIComponent(tagName)}/${encodeURIComponent(assetName)}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return downloadUrl;
  }
}

function sortKeys(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)));
}

export function generateUpdaterManifest({ releaseFile, signatureDir, output }) {
  if (!releaseFile || !signatureDir || !output) {
    throw new Error('Usage: generate-updater-manifest --release-file <json> --signature-dir <dir> --output <file>');
  }

  const release = JSON.parse(fs.readFileSync(releaseFile, 'utf8'));
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const signatures = findSignatureMap(assets);
  const platforms = {};
  const platformAssets = new Map();

  function addPlatform(platform, entry, assetName) {
    const previousAsset = platformAssets.get(platform);
    if (previousAsset) {
      throw new Error(
        `Updater manifest has multiple payloads for ${platform}: `
        + `${previousAsset}, ${assetName}`,
      );
    }
    platforms[platform] = entry;
    platformAssets.set(platform, assetName);
  }

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
        { downloadUrl: canonicalizeAssetDownloadUrl(asset.url, release.tagName, name), name },
        { localPath: signaturePath, name: signatureAsset.name },
      );
      if (!entry) continue;
      addPlatform(`darwin-${arch}`, entry, name);
      addPlatform(`darwin-${arch}-app`, entry, name);
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
        { downloadUrl: canonicalizeAssetDownloadUrl(asset.url, release.tagName, name), name },
        { localPath: signaturePath, name: signatureAsset.name },
      );
      if (!entry) continue;
      const installerKey = (name.endsWith('.msi') || name.endsWith('.msi.zip')) ? 'msi' : 'nsis';
      addPlatform(`windows-${arch}-${installerKey}`, entry, name);
    }
  }

  for (const arch of ['x86_64']) {
    const genericEntry = platforms[`windows-${arch}-msi`]
      || platforms[`windows-${arch}-nsis`];
    if (genericEntry) {
      platforms[`windows-${arch}`] = genericEntry;
    }
  }

  const missingPlatforms = REQUIRED_UPDATER_PLATFORMS
    .filter((platform) => !platforms[platform]);
  if (missingPlatforms.length > 0) {
    throw new Error(
      `Updater manifest is incomplete; missing platforms: ${missingPlatforms.join(', ')}`,
    );
  }

  const manifest = {
    version: release.tagName?.replace(/^v/, '') || release.version,
    notes: release.body || '',
    pub_date: release.publishedAt || new Date().toISOString(),
    platforms: sortKeys(platforms),
  };

  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  generateUpdaterManifest({
    releaseFile: args['release-file'],
    signatureDir: args['signature-dir'],
    output: args.output,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
