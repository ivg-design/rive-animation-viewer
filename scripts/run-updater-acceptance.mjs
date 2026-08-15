import { randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACCEPTANCE_RECEIPT_NAME,
  STAGING_LEDGER_NAME,
  createLoopbackUpdaterManifest,
  sha256File,
  verifyUpdaterStagingLedger,
} from './updater-acceptance-lib.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'src-tauri', 'tauri.conf.json');

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--keep-workdir') {
      args.keepWorkdir = true;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
    args[token.slice(2)] = value;
    index += 1;
  }
  for (const name of ['repo', 'tag', 'expected-commit', 'bootstrap-app', 'output']) {
    if (!args[name]) throw new Error(`--${name} is required`);
  }
  return args;
}

function run(file, args, options = {}) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function readPlistValue(appPath, key) {
  return run('/usr/bin/plutil', [
    '-extract', key, 'raw', '-o', '-', path.join(appPath, 'Contents', 'Info.plist'),
  ]);
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

function protectedAppFingerprint() {
  const appPath = '/Applications/Rive Animation Viewer.app';
  const stat = fs.statSync(appPath, { throwIfNoEntry: false });
  return stat ? { exists: true, inode: stat.ino, modified: stat.mtimeMs, size: stat.size } : { exists: false };
}

function assertNoRunningProductionViewer() {
  const processes = run('/bin/ps', ['-axo', 'command=']);
  if (processes.split('\n').some((line) => line.includes('/Rive Animation Viewer.app/Contents/MacOS/'))) {
    throw new Error('Quit all running Rive Animation Viewer instances before acceptance');
  }
}

function downloadPrivateDraft(args, assetDir) {
  run('gh', ['auth', 'status']);
  const apiPath = `repos/${args.repo}/releases/tags/${encodeURIComponent(args.tag)}`;
  const release = JSON.parse(run('gh', ['api', apiPath]));
  if (release.draft !== true) throw new Error('Acceptance requires an unpublished private draft release');
  if (release.tag_name !== args.tag) throw new Error('Private draft tag mismatch');
  if (release.target_commitish !== args['expected-commit']) {
    throw new Error('Private draft target commit does not match --expected-commit');
  }
  run('gh', ['release', 'download', args.tag, '--repo', args.repo, '--dir', assetDir]);
  return release;
}

function createServer({ localManifestPath, payloadName, payloadPath, token, requests }) {
  const manifestRoute = `/${token}/latest.json`;
  const payloadRoute = `/${token}/payload/${encodeURIComponent(payloadName)}`;
  return http.createServer((request, response) => {
    const requestPath = new URL(request.url, 'http://127.0.0.1').pathname;
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405).end();
      return;
    }
    const selected = requestPath === manifestRoute
      ? { file: localManifestPath, type: 'application/json', counter: 'manifest' }
      : requestPath === payloadRoute
        ? { file: payloadPath, type: 'application/gzip', counter: 'payload' }
        : null;
    if (!selected) {
      response.writeHead(404).end();
      return;
    }
    const stat = fs.statSync(selected.file);
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': stat.size,
      'Content-Type': selected.type,
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    requests[selected.counter] += 1;
    fs.createReadStream(selected.file).pipe(response);
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function waitForRelaunch(root, bootstrapVersion, candidateVersion, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let bootstrapMarker = null;
  while (Date.now() < deadline) {
    for (const name of fs.readdirSync(root).filter((entry) => /^rav-launch-\d+\.json$/.test(entry))) {
      const marker = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
      if (marker.version === bootstrapVersion) bootstrapMarker = marker;
      if (marker.version === candidateVersion && bootstrapMarker && marker.pid !== bootstrapMarker.pid) {
        return { bootstrapMarker, candidateMarker: marker };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for isolated ${bootstrapVersion} -> ${candidateVersion} relaunch`);
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}

async function terminateAndWait(pid) {
  if (!Number.isInteger(pid) || !isRunning(pid)) return;
  process.kill(pid, 'SIGTERM');
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && isRunning(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (isRunning(pid)) {
    process.kill(pid, 'SIGKILL');
  }
}

export async function runUpdaterAcceptance(argv = process.argv.slice(2)) {
  if (process.platform !== 'darwin') throw new Error('Real updater acceptance currently requires macOS');
  const args = parseArgs(argv);
  if (!/^[0-9a-f]{40}$/.test(args['expected-commit'])) throw new Error('--expected-commit must be a full Git SHA');
  assertNoRunningProductionViewer();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rav-updater-acceptance-'));
  const assetDir = path.join(root, 'assets');
  const isolatedHome = path.join(root, 'home');
  const localManifestPath = path.join(root, 'local-latest.json');
  const output = path.resolve(args.output);
  fs.mkdirSync(assetDir);
  fs.mkdirSync(isolatedHome);
  const beforeProtectedApp = protectedAppFingerprint();
  let server;
  let child;
  let bootstrapPid;
  let candidatePid;
  let passed = false;

  try {
    const release = downloadPrivateDraft(args, assetDir);
    const ledgerPath = path.join(assetDir, STAGING_LEDGER_NAME);
    const ledger = await verifyUpdaterStagingLedger({
      assetDir,
      configPath: CONFIG_PATH,
      expectedCommit: args['expected-commit'],
      expectedReleaseId: release.id,
      expectedRepository: args.repo,
      ledgerPath,
    });

    const architecture = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x64' : null;
    if (!architecture) throw new Error(`Unsupported macOS architecture: ${process.arch}`);
    const payloadName = `Rive.Animation.Viewer_${architecture}.app.tar.gz`;
    const payloadPath = path.join(assetDir, payloadName);
    const platformKeys = architecture === 'aarch64'
      ? ['darwin-aarch64', 'darwin-aarch64-app']
      : ['darwin-x86_64', 'darwin-x86_64-app'];

    const token = randomBytes(24).toString('hex');
    const requests = { manifest: 0, payload: 0 };
    server = createServer({ localManifestPath, payloadName, payloadPath, requests, token });
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}/${token}`;
    createLoopbackUpdaterManifest({
      baseUrl,
      canonicalManifestPath: path.join(assetDir, 'latest.json'),
      output: localManifestPath,
      payloadName,
      platformKeys,
    });

    const bootstrapSource = path.resolve(args['bootstrap-app']);
    const bootstrapTarget = path.join(root, 'Rive Animation Viewer.app');
    run('/usr/bin/ditto', ['--noqtn', bootstrapSource, bootstrapTarget]);
    const bootstrapVersion = readPlistValue(bootstrapTarget, 'CFBundleShortVersionString');
    if (compareVersions(bootstrapVersion, ledger.version) >= 0) {
      throw new Error(`Bootstrap ${bootstrapVersion} must be older than candidate ${ledger.version}`);
    }
    const executable = path.join(
      bootstrapTarget,
      'Contents',
      'MacOS',
      readPlistValue(bootstrapTarget, 'CFBundleExecutable'),
    );
    const stdout = fs.openSync(path.join(root, 'app-stdout.log'), 'w');
    const stderr = fs.openSync(path.join(root, 'app-stderr.log'), 'w');
    child = spawn(executable, [], {
      detached: false,
      env: {
        ...process.env,
        HOME: isolatedHome,
        TMPDIR: root,
        XDG_CACHE_HOME: path.join(isolatedHome, '.cache'),
        XDG_CONFIG_HOME: path.join(isolatedHome, '.config'),
        XDG_DATA_HOME: path.join(isolatedHome, '.local', 'share'),
        RAV_UPDATER_ACCEPTANCE: '1',
        RAV_UPDATER_ACCEPTANCE_AUTO_INSTALL: '1',
        RAV_UPDATER_ACCEPTANCE_ENDPOINT: `${baseUrl}/latest.json`,
        RAV_UPDATER_ACCEPTANCE_ROOT: root,
      },
      stdio: ['ignore', stdout, stderr],
    });
    fs.closeSync(stdout);
    fs.closeSync(stderr);

    const { bootstrapMarker, candidateMarker } = await waitForRelaunch(
      root,
      bootstrapVersion,
      ledger.version,
    );
    bootstrapPid = bootstrapMarker.pid;
    candidatePid = candidateMarker.pid;
    if (!path.resolve(candidateMarker.executable).startsWith(`${bootstrapTarget}${path.sep}`)) {
      throw new Error('Relaunched candidate executable escaped the isolated app bundle');
    }
    if (readPlistValue(bootstrapTarget, 'CFBundleShortVersionString') !== ledger.version) {
      throw new Error('Installed app bundle version does not match staged candidate');
    }
    if (requests.manifest < 1 || requests.payload < 1) {
      throw new Error('Updater did not request both the manifest and signed payload');
    }
    if (JSON.stringify(beforeProtectedApp) !== JSON.stringify(protectedAppFingerprint())) {
      throw new Error('/Applications/Rive Animation Viewer.app changed during isolated acceptance');
    }

    const payload = ledger.assets.find((asset) => asset.name === payloadName);
    const manifest = ledger.assets.find((asset) => asset.name === 'latest.json');
    const receipt = {
      schemaVersion: 1,
      kind: 'rav-updater-acceptance-receipt',
      status: 'passed',
      generatedAt: new Date().toISOString(),
      repository: ledger.repository,
      releaseId: ledger.releaseId,
      tag: ledger.tag,
      candidateCommit: ledger.candidateCommit,
      bootstrapVersion,
      installedVersion: ledger.version,
      ledgerSha256: sha256File(ledgerPath),
      canonicalManifestSha256: manifest.sha256,
      localManifestSha256: sha256File(localManifestPath),
      loopbackBaseUrl: baseUrl,
      payload,
      platformKeys,
      manifestRequests: requests.manifest,
      payloadRequests: requests.payload,
      runtimeSignatureVerification: true,
      relaunchObserved: candidateMarker.pid !== bootstrapMarker.pid,
      isolatedTempBundle: true,
      protectedApplicationsBundleUnchanged: true,
    };
    await terminateAndWait(candidatePid);
    await terminateAndWait(bootstrapPid);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
    passed = true;
    return receipt;
  } finally {
    await terminateAndWait(candidatePid);
    await terminateAndWait(bootstrapPid || child?.pid);
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
    if (passed && !args.keepWorkdir) fs.rmSync(root, { recursive: true, force: true });
    else if (!passed) console.error(`Acceptance work directory retained for diagnosis: ${root}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runUpdaterAcceptance().then((receipt) => {
    console.log(`Updater acceptance passed; receipt: ${path.resolve(process.argv[process.argv.indexOf('--output') + 1] || ACCEPTANCE_RECEIPT_NAME)}`);
    console.log(`Candidate ${receipt.candidateCommit} installed and relaunched as ${receipt.installedVersion}`);
  }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
