import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  loadUpdaterPublicKey,
  verifyUpdaterArtifacts,
} from './verify-updater-signatures.mjs';

export const STAGING_LEDGER_NAME = 'updater-staging-ledger.json';
export const ACCEPTANCE_RECEIPT_NAME = 'updater-acceptance-receipt.json';
export const ENCODER_SOURCE_ASSET_NAME = 'jellyfin-ffmpeg-v7.1.4-3-source.tar.gz';

function fail(message) {
  throw new Error(message);
}

export function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export function sha256Value(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function expectedUpdaterAssetNames(version) {
  return [
    `Rive.Animation.Viewer_${version}_aarch64.dmg`,
    `Rive.Animation.Viewer_${version}_x64.dmg`,
    'Rive.Animation.Viewer_aarch64.app.tar.gz',
    'Rive.Animation.Viewer_aarch64.app.tar.gz.sig',
    'Rive.Animation.Viewer_x64.app.tar.gz',
    'Rive.Animation.Viewer_x64.app.tar.gz.sig',
    `Rive.Animation.Viewer_${version}_x64_en-US.msi`,
    `Rive.Animation.Viewer_${version}_x64_en-US.msi.sig`,
    `Rive.Animation.Viewer_${version}_x64-setup.exe`,
    `Rive.Animation.Viewer_${version}_x64-setup.exe.sig`,
    ENCODER_SOURCE_ASSET_NAME,
    'latest.json',
  ];
}

function updaterPayloadNames(version) {
  return [
    'Rive.Animation.Viewer_aarch64.app.tar.gz',
    'Rive.Animation.Viewer_x64.app.tar.gz',
    `Rive.Animation.Viewer_${version}_x64_en-US.msi`,
    `Rive.Animation.Viewer_${version}_x64-setup.exe`,
  ];
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`Could not read ${label} ${filePath}: ${error.message}`);
  }
}

function fileRecord(assetDir, name) {
  const filePath = path.join(assetDir, name);
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size === 0) {
    fail(`Missing or empty staged updater asset: ${name}`);
  }
  return { name, bytes: stat.size, sha256: sha256File(filePath) };
}

export async function createUpdaterStagingLedger({
  assetDir,
  commit,
  configPath,
  output,
  releaseFile,
  releaseId,
  repository,
  version,
}) {
  const release = readJson(releaseFile, 'release metadata');
  if (release.isDraft !== true || release.tagName !== `v${version}`) {
    fail(`Expected private draft v${version}`);
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) fail('Candidate commit must be a full Git SHA');
  if (release.targetCommitish && release.targetCommitish !== commit) {
    fail('Private draft target commit differs from candidate commit');
  }
  if (!release.createdAt) fail('Private draft metadata must include createdAt');

  const names = expectedUpdaterAssetNames(version);
  const records = names.map((name) => fileRecord(assetDir, name));
  await verifyUpdaterArtifacts(
    updaterPayloadNames(version).map((name) => path.join(assetDir, name)),
    { configPath },
  );
  const key = loadUpdaterPublicKey(configPath);
  const manifest = readJson(path.join(assetDir, 'latest.json'), 'updater manifest');
  if (manifest.version !== version) fail(`latest.json is not version ${version}`);

  const ledger = {
    schemaVersion: 1,
    kind: 'rav-updater-staging-ledger',
    repository,
    releaseId: String(releaseId),
    tag: `v${version}`,
    version,
    candidateCommit: commit,
    releaseCreatedAt: release.createdAt,
    updaterKeyId: key.keyIdHex,
    tauriConfigSha256: sha256File(configPath),
    assets: records.sort((a, b) => a.name.localeCompare(b.name)),
  };
  fs.writeFileSync(output, `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger;
}

export async function verifyUpdaterStagingLedger({
  assetDir,
  configPath,
  expectedCommit,
  expectedReleaseId,
  expectedRepository,
  ledgerPath,
}) {
  const ledger = readJson(ledgerPath, 'updater staging ledger');
  if (ledger.kind !== 'rav-updater-staging-ledger' || ledger.schemaVersion !== 1) {
    fail('Unsupported updater staging ledger');
  }
  if (ledger.candidateCommit !== expectedCommit) fail('Staging ledger commit mismatch');
  if (ledger.repository !== expectedRepository) fail('Staging ledger repository mismatch');
  if (String(ledger.releaseId) !== String(expectedReleaseId)) fail('Staging ledger release mismatch');
  if (sha256File(configPath) !== ledger.tauriConfigSha256) fail('Tauri config differs from staged commit');
  const config = readJson(configPath, 'Tauri config');
  if (ledger.version !== config.version || ledger.tag !== `v${config.version}`) {
    fail('Staging ledger version/tag differs from the exact Tauri config');
  }

  const expectedNames = expectedUpdaterAssetNames(ledger.version).sort();
  const recordedNames = ledger.assets.map((asset) => asset.name).sort();
  if (JSON.stringify(recordedNames) !== JSON.stringify(expectedNames)) {
    fail('Staging ledger asset inventory is incomplete or unexpected');
  }
  const allowedNames = new Set([
    ...expectedNames,
    STAGING_LEDGER_NAME,
    ACCEPTANCE_RECEIPT_NAME,
  ]);
  const unexpectedFiles = fs.readdirSync(assetDir)
    .filter((name) => fs.statSync(path.join(assetDir, name)).isFile() && !allowedNames.has(name));
  if (unexpectedFiles.length > 0) {
    fail(`Private draft has unexpected assets: ${unexpectedFiles.sort().join(', ')}`);
  }
  for (const record of ledger.assets) {
    const current = fileRecord(assetDir, record.name);
    if (current.bytes !== record.bytes || current.sha256 !== record.sha256) {
      fail(`Staged updater bytes changed: ${record.name}`);
    }
  }
  const results = await verifyUpdaterArtifacts(
    updaterPayloadNames(ledger.version).map((name) => path.join(assetDir, name)),
    { configPath },
  );
  if (results.some((result) => result.keyId !== ledger.updaterKeyId)) {
    fail('Staged updater signature key differs from ledger');
  }
  return ledger;
}

export function assertLoopbackManifestUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) fail('Local manifest URL must use HTTP or HTTPS');
  if (!['127.0.0.1', '[::1]'].includes(url.hostname)) fail('Local manifest URL must use a loopback IP literal');
  if (!url.port) fail('Local manifest URL must use an explicit port');
  if (url.username || url.password || url.search || url.hash) fail('Local manifest URL contains unsafe URL fields');
  return url;
}

export function buildLoopbackUpdaterManifest({
  baseUrl,
  canonicalManifest,
  payloadName,
  platformKeys,
}) {
  const endpoint = assertLoopbackManifestUrl(`${baseUrl.replace(/\/$/, '')}/latest.json`);
  if (!/^\/[0-9a-f]{48}\/latest\.json$/.test(endpoint.pathname)) {
    fail('Local manifest URL must contain one random 48-character token path');
  }
  const manifest = JSON.parse(JSON.stringify(canonicalManifest));
  for (const key of platformKeys) {
    if (!manifest.platforms?.[key]?.signature) fail(`Canonical manifest has no signed ${key} entry`);
    manifest.platforms[key] = {
      ...manifest.platforms[key],
      url: new URL(`payload/${encodeURIComponent(payloadName)}`, endpoint).toString(),
    };
  }
  return manifest;
}

export function createLoopbackUpdaterManifest({
  baseUrl,
  canonicalManifestPath,
  output,
  payloadName,
  platformKeys,
}) {
  const manifest = buildLoopbackUpdaterManifest({
    baseUrl,
    canonicalManifest: readJson(canonicalManifestPath, 'canonical updater manifest'),
    payloadName,
    platformKeys,
  });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function verifyUpdaterAcceptanceReceipt({ ledgerPath, receiptPath }) {
  const ledger = readJson(ledgerPath, 'updater staging ledger');
  const receipt = readJson(receiptPath, 'updater acceptance receipt');
  if (receipt.kind !== 'rav-updater-acceptance-receipt' || receipt.status !== 'passed') {
    fail('Updater acceptance receipt is not a passing receipt');
  }
  if (Number.isNaN(Date.parse(receipt.generatedAt))) fail('Updater acceptance receipt has no valid timestamp');
  const payload = ledger.assets.find((asset) => asset.name === receipt.payload?.name);
  const manifest = ledger.assets.find((asset) => asset.name === 'latest.json');
  const canonicalManifestPath = path.join(path.dirname(ledgerPath), 'latest.json');
  const requiredMatches = [
    [receipt.repository, ledger.repository, 'repository'],
    [receipt.releaseId, ledger.releaseId, 'release'],
    [receipt.tag, ledger.tag, 'tag'],
    [receipt.candidateCommit, ledger.candidateCommit, 'commit'],
    [receipt.installedVersion, ledger.version, 'installed version'],
    [receipt.ledgerSha256, sha256File(ledgerPath), 'ledger digest'],
    [receipt.canonicalManifestSha256, manifest?.sha256, 'manifest digest'],
    [receipt.payload?.sha256, payload?.sha256, 'payload digest'],
  ];
  for (const [actual, expected, label] of requiredMatches) {
    if (String(actual) !== String(expected)) fail(`Acceptance receipt ${label} mismatch`);
  }
  if (sha256File(canonicalManifestPath) !== manifest?.sha256) {
    fail('Canonical updater manifest bytes differ from the staging ledger');
  }
  const allowedPlatformSets = [
    ['darwin-aarch64', 'darwin-aarch64-app'],
    ['darwin-x86_64', 'darwin-x86_64-app'],
  ];
  if (!allowedPlatformSets.some((keys) => JSON.stringify(keys) === JSON.stringify(receipt.platformKeys))) {
    fail('Acceptance receipt platform keys are invalid');
  }
  const expectedPayloadName = receipt.platformKeys[0] === 'darwin-aarch64'
    ? 'Rive.Animation.Viewer_aarch64.app.tar.gz'
    : 'Rive.Animation.Viewer_x64.app.tar.gz';
  if (receipt.payload?.name !== expectedPayloadName) fail('Acceptance receipt payload/platform mismatch');
  const rebuiltLocalManifest = buildLoopbackUpdaterManifest({
    baseUrl: receipt.loopbackBaseUrl,
    canonicalManifest: readJson(canonicalManifestPath, 'canonical updater manifest'),
    payloadName: receipt.payload.name,
    platformKeys: receipt.platformKeys,
  });
  const rebuiltDigest = sha256Value(`${JSON.stringify(rebuiltLocalManifest, null, 2)}\n`);
  if (receipt.localManifestSha256 !== rebuiltDigest) {
    fail('Acceptance receipt local manifest digest or loopback routes are invalid');
  }
  if (!(receipt.manifestRequests >= 1) || !(receipt.payloadRequests >= 1)) {
    fail('Acceptance receipt did not observe manifest and payload downloads');
  }
  if (
    receipt.runtimeSignatureVerification !== true
    || receipt.relaunchObserved !== true
    || receipt.isolatedTempBundle !== true
    || receipt.protectedApplicationsBundleUnchanged !== true
    || receipt.protectedProductionUserDataUnchanged !== true
  ) {
    fail('Acceptance receipt did not prove isolated relaunch');
  }
  for (const [fingerprint, label] of [
    [receipt.protectedApplicationsFingerprint, 'applications'],
    [receipt.protectedProductionUserDataFingerprint, 'production user data'],
  ]) {
    if (!fingerprint
      || !/^[0-9a-f]{64}$/.test(String(fingerprint.sha256))
      || !Number.isSafeInteger(fingerprint.fileCount)
      || !Number.isSafeInteger(fingerprint.byteCount)
      || !Number.isSafeInteger(fingerprint.existingRootCount)) {
      fail(`Acceptance receipt ${label} fingerprint is invalid`);
    }
  }
  return receipt;
}
