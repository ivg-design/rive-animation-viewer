import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifyEd25519,
} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { fileURLToPath } from 'node:url';

const TRUSTED_COMMENT_PREFIX = 'trusted comment: ';
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_TAURI_CONFIG_PATH = path.resolve(
  SCRIPT_DIR,
  '..',
  'src-tauri',
  'tauri.conf.json',
);

function fail(message) {
  throw new Error(message);
}

function decodeBase64(value, label) {
  if (typeof value !== 'string') {
    fail(`${label} must be a base64 string`);
  }

  const encoded = value.trim();
  const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!encoded || encoded.length % 4 !== 0 || !base64Pattern.test(encoded)) {
    fail(`${label} is not valid base64`);
  }

  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.toString('base64') !== encoded) {
    fail(`${label} is not canonical base64`);
  }
  return decoded;
}

function decodeUtf8(value, label) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    fail(`${label} is not valid UTF-8`);
  }
}

function signatureAlgorithm(bytes, label) {
  const algorithm = bytes.toString('ascii');
  if (algorithm === 'ED') return 'prehashed';
  if (algorithm === 'Ed') return 'legacy';
  fail(`${label} uses unsupported Minisign algorithm ${JSON.stringify(algorithm)}`);
}

function keyIdForDisplay(keyId) {
  return Buffer.from(keyId).reverse().toString('hex').toUpperCase();
}

function signatureLines(signatureText) {
  const lines = signatureText.replace(/\r\n/g, '\n').split('\n');
  while (lines.at(-1) === '') lines.pop();
  if (lines.length !== 4) {
    fail(`Tauri signature must decode to exactly four Minisign lines; found ${lines.length}`);
  }
  return lines;
}

export function parseTauriUpdaterPublicKey(encodedPublicKey) {
  const publicKeyText = decodeUtf8(
    decodeBase64(encodedPublicKey, 'Tauri updater public key'),
    'Tauri updater public key',
  );
  const lines = publicKeyText.replace(/\r\n/g, '\n').split('\n');
  while (lines.at(-1) === '') lines.pop();
  if (lines.length !== 2) {
    fail(`Tauri updater public key must decode to exactly two Minisign lines; found ${lines.length}`);
  }

  const keyRecord = decodeBase64(lines[1], 'Minisign public key record');
  if (keyRecord.length !== 42) {
    fail(`Minisign public key record must be 42 bytes; found ${keyRecord.length}`);
  }
  signatureAlgorithm(keyRecord.subarray(0, 2), 'Minisign public key');

  const keyId = keyRecord.subarray(2, 10);
  const rawPublicKey = keyRecord.subarray(10);
  const publicKey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, rawPublicKey]),
    format: 'der',
    type: 'spki',
  });

  return {
    keyId,
    keyIdHex: keyIdForDisplay(keyId),
    publicKey,
  };
}

export function loadUpdaterPublicKey(configPath = DEFAULT_TAURI_CONFIG_PATH) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    fail(`Could not read Tauri config ${configPath}: ${error.message}`);
  }

  const encodedPublicKey = config?.plugins?.updater?.pubkey;
  if (!encodedPublicKey) {
    fail(`Tauri config ${configPath} has no plugins.updater.pubkey`);
  }
  return parseTauriUpdaterPublicKey(encodedPublicKey);
}

export function parseTauriUpdaterSignature(encodedSignature) {
  const signatureText = decodeUtf8(
    decodeBase64(encodedSignature, 'Tauri updater signature'),
    'Tauri updater signature',
  );
  const [
    ,
    signatureRecordLine,
    trustedCommentLine,
    globalSignatureLine,
  ] = signatureLines(signatureText);

  if (!trustedCommentLine.startsWith(TRUSTED_COMMENT_PREFIX)) {
    fail(`Tauri updater signature has no ${JSON.stringify(TRUSTED_COMMENT_PREFIX)} line`);
  }

  const signatureRecord = decodeBase64(
    signatureRecordLine,
    'Minisign signature record',
  );
  if (signatureRecord.length !== 74) {
    fail(`Minisign signature record must be 74 bytes; found ${signatureRecord.length}`);
  }

  const globalSignature = decodeBase64(
    globalSignatureLine,
    'Minisign global signature',
  );
  if (globalSignature.length !== 64) {
    fail(`Minisign global signature must be 64 bytes; found ${globalSignature.length}`);
  }

  return {
    mode: signatureAlgorithm(
      signatureRecord.subarray(0, 2),
      'Minisign signature',
    ),
    keyId: signatureRecord.subarray(2, 10),
    signature: signatureRecord.subarray(10),
    trustedComment: trustedCommentLine.slice(TRUSTED_COMMENT_PREFIX.length),
    globalSignature,
  };
}

async function payloadForVerification(artifactPath, mode) {
  if (mode === 'legacy') {
    return fs.promises.readFile(artifactPath);
  }

  const hash = createHash('blake2b512');
  for await (const chunk of fs.createReadStream(artifactPath)) {
    hash.update(chunk);
  }
  return hash.digest();
}

export async function verifyUpdaterArtifact({
  artifactPath,
  signaturePath = `${artifactPath}.sig`,
  configPath = DEFAULT_TAURI_CONFIG_PATH,
} = {}) {
  if (!artifactPath) {
    fail('An updater artifact path is required');
  }

  const absoluteArtifactPath = path.resolve(artifactPath);
  const absoluteSignaturePath = path.resolve(signaturePath);
  const absoluteConfigPath = path.resolve(configPath);
  const publicKey = loadUpdaterPublicKey(absoluteConfigPath);

  let encodedSignature;
  let artifactStat;
  try {
    [encodedSignature, artifactStat] = await Promise.all([
      fs.promises.readFile(absoluteSignaturePath, 'utf8'),
      fs.promises.stat(absoluteArtifactPath),
    ]);
  } catch (error) {
    fail(`Could not read updater artifact or signature: ${error.message}`);
  }
  if (!artifactStat.isFile()) {
    fail(`Updater artifact is not a regular file: ${absoluteArtifactPath}`);
  }

  const signature = parseTauriUpdaterSignature(encodedSignature);
  if (
    signature.keyId.length !== publicKey.keyId.length
    || !timingSafeEqual(signature.keyId, publicKey.keyId)
  ) {
    fail(
      `Updater signature key ${keyIdForDisplay(signature.keyId)} does not match `
      + `the embedded Tauri updater key ${publicKey.keyIdHex}`,
    );
  }

  const trustedCommentPayload = Buffer.concat([
    signature.signature,
    Buffer.from(signature.trustedComment, 'utf8'),
  ]);
  if (
    !verifyEd25519(
      null,
      trustedCommentPayload,
      publicKey.publicKey,
      signature.globalSignature,
    )
  ) {
    fail(`Updater signature trusted comment is invalid: ${absoluteSignaturePath}`);
  }

  let payload;
  try {
    payload = await payloadForVerification(absoluteArtifactPath, signature.mode);
  } catch (error) {
    fail(`Could not read updater artifact ${absoluteArtifactPath}: ${error.message}`);
  }

  if (
    !verifyEd25519(
      null,
      payload,
      publicKey.publicKey,
      signature.signature,
    )
  ) {
    fail(`Updater signature does not match artifact bytes: ${absoluteArtifactPath}`);
  }

  return {
    artifactPath: absoluteArtifactPath,
    signaturePath: absoluteSignaturePath,
    byteLength: artifactStat.size,
    keyId: publicKey.keyIdHex,
    mode: signature.mode,
  };
}

export async function verifyUpdaterArtifacts(
  artifactPaths,
  { configPath = DEFAULT_TAURI_CONFIG_PATH } = {},
) {
  if (!Array.isArray(artifactPaths) || artifactPaths.length === 0) {
    fail('At least one updater artifact path is required');
  }

  const results = [];
  for (const artifactPath of artifactPaths) {
    results.push(await verifyUpdaterArtifact({ artifactPath, configPath }));
  }
  return results;
}

function parseCliArgs(argv) {
  const artifactPaths = [];
  let configPath = DEFAULT_TAURI_CONFIG_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') {
      return { help: true, artifactPaths, configPath };
    }
    if (value === '--config') {
      const next = argv[index + 1];
      if (!next || next.startsWith('-')) {
        fail('--config requires a path');
      }
      configPath = next;
      index += 1;
      continue;
    }
    if (value.startsWith('-')) {
      fail(`Unknown option: ${value}`);
    }
    artifactPaths.push(value);
  }

  return { help: false, artifactPaths, configPath };
}

function printUsage() {
  console.log(
    'Usage: node scripts/verify-updater-signatures.mjs '
    + '[--config src-tauri/tauri.conf.json] <payload> [<payload> ...]\n'
    + 'Each payload must have a sibling <payload>.sig generated by the Tauri bundler.',
  );
}

async function main() {
  const { help, artifactPaths, configPath } = parseCliArgs(process.argv.slice(2));
  if (help) {
    printUsage();
    return;
  }

  const results = await verifyUpdaterArtifacts(artifactPaths, { configPath });
  for (const result of results) {
    console.log(
      `Verified ${result.artifactPath} (${result.byteLength} bytes, `
      + `${result.mode}, key ${result.keyId})`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
