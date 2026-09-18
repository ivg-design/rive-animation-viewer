#!/usr/bin/env node
// Stages the separately distributed file-inspection module into this tree.
// The module ships as one zip with a manifest; the public repository carries
// only the loader (`src/app/rive/inspection/parser-client.js`), this script,
// and the gitignore entries for the staged paths. Same shape as the encoder
// distribution: acquire by URL with a pinned sha256, stage, verify.
//
//   private-modules.mjs pack    --out FILE.zip [--source-root DIR]
//   private-modules.mjs stage   --bundle FILE.zip [--sha256 HEX] [--root DIR]
//   private-modules.mjs acquire --url URL --sha256 HEX --cache-dir DIR [--token-env NAME] [--root DIR]
//   private-modules.mjs verify  [--root DIR]
//   private-modules.mjs strip   [--root DIR]
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const STAGED_DIRECTORIES = [
    'src/app/rive/inspection/private',
    'tests/unit/rive/inspection/private',
    'vendor/inspection',
];
const MANIFEST_PATH = 'src/app/rive/inspection/private/manifest.json';
const REPO_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const fail = (message) => { console.error(`private-modules: ${message}`); process.exit(1); };

function parseOptions(args) {
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
        const flag = args[index]; const value = args[index + 1];
        if (!flag?.startsWith('--') || value === undefined) fail(`invalid option near ${flag || '<end>'}`);
        options[flag.slice(2)] = value;
    }
    return options;
}

function listFiles(directory, root) {
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) return listFiles(full, root);
        return entry.isFile() && entry.name !== 'manifest.json' && entry.name !== '.DS_Store' ? [path.relative(root, full).split(path.sep).join('/')] : [];
    }).sort();
}

function buildManifest(root) {
    const files = STAGED_DIRECTORIES.flatMap((dir) => listFiles(path.join(root, dir), root));
    if (!files.length) fail('no private module files found to pack');
    return {
        schemaVersion: 1,
        module: 'file-inspection',
        createdAt: new Date().toISOString(),
        files: files.map((file) => ({ path: file, sha256: sha256(readFileSync(path.join(root, file))), bytes: statSync(path.join(root, file)).size })),
    };
}

function pack({ out, 'source-root': sourceRoot = REPO_ROOT }) {
    if (!out) fail('--out is required');
    const manifest = buildManifest(sourceRoot);
    const work = mkdtempSync(path.join(tmpdir(), 'rav-private-modules-'));
    for (const file of manifest.files) {
        mkdirSync(path.dirname(path.join(work, file.path)), { recursive: true });
        cpSync(path.join(sourceRoot, file.path), path.join(work, file.path));
    }
    writeFileSync(path.join(work, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    rmSync(out, { force: true });
    mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    execFileSync('zip', ['-qr', '-X', path.resolve(out), '.'], { cwd: work });
    rmSync(work, { recursive: true, force: true });
    const digest = sha256(readFileSync(out));
    writeFileSync(`${out}.sha256`, `${digest}  ${path.basename(out)}\n`);
    console.log(`packed ${manifest.files.length} files → ${out}\nsha256 ${digest}`);
}

function strip({ root = REPO_ROOT }) {
    for (const dir of STAGED_DIRECTORIES) rmSync(path.join(root, dir), { recursive: true, force: true });
    console.log('stripped staged private module paths');
}

function verify({ root = REPO_ROOT }, { quiet = false } = {}) {
    const manifestFile = path.join(root, MANIFEST_PATH);
    if (!existsSync(manifestFile)) fail(`not staged: ${MANIFEST_PATH} is missing`);
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    const problems = [];
    for (const file of manifest.files) {
        const full = path.join(root, file.path);
        if (!existsSync(full)) { problems.push(`missing ${file.path}`); continue; }
        if (sha256(readFileSync(full)) !== file.sha256) problems.push(`hash mismatch ${file.path}`);
    }
    const expected = new Set(manifest.files.map((file) => file.path));
    for (const dir of STAGED_DIRECTORIES) {
        for (const file of listFiles(path.join(root, dir), root)) if (!expected.has(file)) problems.push(`unexpected ${file}`);
    }
    if (problems.length) fail(`verification failed:\n  ${problems.join('\n  ')}`);
    if (!quiet) console.log(`verified ${manifest.files.length} staged files (${manifest.module})`);
    return manifest;
}

function extract(archive, destination) {
    // unzip on macOS/Linux; Git-bash on Windows runners lacks it, bsdtar/7z do not.
    const attempts = [['unzip', ['-q', archive, '-d', destination]], ['tar', ['-xf', archive, '-C', destination]], ['7z', ['x', '-y', `-o${destination}`, archive]]];
    const errors = [];
    for (const [command, args] of attempts) {
        try { execFileSync(command, args, { stdio: 'pipe' }); return; } catch (error) { errors.push(`${command}: ${error.message.split('\n')[0]}`); }
    }
    fail(`could not extract ${archive}:\n  ${errors.join('\n  ')}`);
}

function stage({ bundle, sha256: expected, root = REPO_ROOT }) {
    if (!bundle) fail('--bundle is required');
    const bytes = readFileSync(bundle);
    if (expected && sha256(bytes) !== expected.toLowerCase()) fail(`bundle sha256 mismatch for ${bundle}`);
    const work = mkdtempSync(path.join(tmpdir(), 'rav-private-modules-'));
    extract(path.resolve(bundle), work);
    const manifest = JSON.parse(readFileSync(path.join(work, 'manifest.json'), 'utf8'));
    strip({ root });
    for (const file of manifest.files) {
        const source = path.join(work, file.path);
        if (sha256(readFileSync(source)) !== file.sha256) fail(`bundle content mismatch ${file.path}`);
        mkdirSync(path.dirname(path.join(root, file.path)), { recursive: true });
        cpSync(source, path.join(root, file.path));
    }
    mkdirSync(path.dirname(path.join(root, MANIFEST_PATH)), { recursive: true });
    cpSync(path.join(work, 'manifest.json'), path.join(root, MANIFEST_PATH));
    rmSync(work, { recursive: true, force: true });
    verify({ root });
}

async function acquire({ url, sha256: expected, 'cache-dir': cacheDir, 'token-env': tokenEnv = 'RAV_PRIVATE_MODULES_TOKEN', root = REPO_ROOT }) {
    if (!url || !expected || !cacheDir) fail('--url, --sha256 and --cache-dir are required');
    mkdirSync(cacheDir, { recursive: true });
    const cached = path.join(cacheDir, `${expected.toLowerCase()}.zip`);
    if (!existsSync(cached) || sha256(readFileSync(cached)) !== expected.toLowerCase()) {
        const headers = { Accept: 'application/octet-stream' };
        const token = process.env[tokenEnv];
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(url, { headers, redirect: 'follow' });
        if (!response.ok) fail(`download failed: ${response.status} ${response.statusText}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (sha256(bytes) !== expected.toLowerCase()) fail('downloaded bundle sha256 mismatch');
        writeFileSync(cached, bytes);
    }
    stage({ bundle: cached, sha256: expected, root });
}

const [command, ...rest] = process.argv.slice(2);
const options = parseOptions(rest);
const commands = { pack, stage, acquire, verify, strip };
if (!commands[command]) fail(`unknown command ${command || '<none>'}; use pack | stage | acquire | verify | strip`);
await commands[command](options);
