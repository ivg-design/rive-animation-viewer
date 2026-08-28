#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const buildCounterFile = path.join(root, '.cache', 'build-counter.txt');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));

function isCiBuild() {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
}

function getBuildChannel() {
  const explicitChannel = String(process.env.APP_BUILD_CHANNEL || '').trim().toLowerCase();
  if (explicitChannel === 'dev' || explicitChannel === 'release') {
    return explicitChannel;
  }
  const tauriDebug = String(process.env.TAURI_ENV_DEBUG || '').trim().toLowerCase();
  if (tauriDebug === 'true') {
    return 'dev';
  }
  if (tauriDebug === 'false') {
    return 'release';
  }
  return isCiBuild() ? 'release' : 'dev';
}

function getGitShortSha() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'nogit';
  }
}

function runGit(args, allowedStatuses = [0]) {
  const result = spawnSync('git', args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }
  if (!allowedStatuses.includes(result.status)) {
    const stderr = result.stderr.trim();
    throw new Error(
      `git ${args.join(' ')} exited with status ${result.status}${stderr ? `: ${stderr}` : ''}`,
    );
  }
  return result;
}

function getGitWorktreeState() {
  try {
    // Use content-aware comparisons for tracked files. On Windows, Tauri's TOML
    // round-trip can change CRLF worktree bytes to LF while Git's normalized
    // content remains identical; porcelain status alone can mislabel that as dirty.
    const unstaged = runGit(['diff', '--quiet', '--no-ext-diff', '--'], [0, 1]);
    const staged = runGit(['diff', '--cached', '--quiet', '--no-ext-diff', '--'], [0, 1]);
    const untrackedResult = runGit(['ls-files', '--others', '--exclude-standard', '-z']);
    const untracked = untrackedResult.stdout.split('\0').filter(Boolean);
    const dirty = unstaged.status === 1 || staged.status === 1 || untracked.length > 0;
    const diagnostics = [];

    if (unstaged.status === 1) {
      const details = runGit(['diff', '--name-status', '--no-ext-diff', '--']).stdout.trim();
      diagnostics.push(`unstaged:\n${details || '(tracked content differs)'}`);
    }
    if (staged.status === 1) {
      const details = runGit([
        'diff',
        '--cached',
        '--name-status',
        '--no-ext-diff',
        '--',
      ]).stdout.trim();
      diagnostics.push(`staged:\n${details || '(index content differs)'}`);
    }
    if (untracked.length > 0) {
      diagnostics.push(`untracked:\n${untracked.map((file) => `? ${file}`).join('\n')}`);
    }

    return { dirty, diagnostics: diagnostics.join('\n') };
  } catch (error) {
    if (isCiBuild()) {
      console.error('Unable to collect Git worktree status for a CI distribution build.');
      throw new Error('CI distribution builds require readable Git status.', { cause: error });
    }
    console.warn('Unable to collect Git worktree status; local build cleanliness is unknown.');
    return { dirty: false, diagnostics: '' };
  }
}

function getGitCommitCount() {
  try {
    return execSync('git rev-list --count HEAD', {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}

function getBuildTimestamp() {
  const date = new Date();
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}${month}${day}-${hour}${minute}`;
}

function parseCliBuildNumber(argv) {
  const arg = argv.find((value) => value.startsWith('--build-number='));
  if (!arg) {
    return '';
  }
  const value = arg.slice('--build-number='.length).trim();
  return /^[0-9]+$/.test(value) ? value : '';
}

function normalizeBuildNumber(value) {
  const raw = String(value || '').trim();
  if (!/^[0-9]+$/.test(raw)) {
    return '';
  }
  return String(Number.parseInt(raw, 10));
}

async function getAutoIncrementBuildNumber(gitBuildNumber) {
  const gitNumber = Number.parseInt(normalizeBuildNumber(gitBuildNumber) || '0', 10);
  let stored = 0;
  try {
    const raw = await fs.readFile(buildCounterFile, 'utf8');
    const parsed = Number.parseInt(String(raw).trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      stored = parsed;
    }
  } catch {
    // first build on this machine/worktree, no persisted counter yet
  }

  const next = Math.max(stored + 1, gitNumber || 0);
  await ensureDir(path.dirname(buildCounterFile));
  await fs.writeFile(buildCounterFile, `${next}\n`, 'utf8');
  return String(next);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

async function copyDir(src, dest) {
  const entries = await fs.readdir(src, { withFileTypes: true });
  await ensureDir(dest);
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
    }
  }
}

async function build() {
  const gitWorktreeState = getGitWorktreeState();
  if (gitWorktreeState.dirty && isCiBuild()) {
    console.error('Refusing CI distribution build from a dirty Git checkout:');
    console.error(gitWorktreeState.diagnostics);
    throw new Error('CI distribution builds require a clean Git checkout.');
  }
  const gitWorktreeSuffix = gitWorktreeState.dirty ? '-dirty' : '';
  await fs.rm(distDir, { recursive: true, force: true });
  await ensureDir(distDir);
  const cliBuildNumber = parseCliBuildNumber(process.argv.slice(2));
  const envBuildNumber = normalizeBuildNumber(process.env.APP_BUILD_NUMBER);
  const gitBuildNumber = normalizeBuildNumber(getGitCommitCount());
  const buildNumber = cliBuildNumber || envBuildNumber || await getAutoIncrementBuildNumber(gitBuildNumber);
  const buildNumberSource = cliBuildNumber
    ? 'cli'
    : envBuildNumber
      ? 'env'
      : 'auto-counter';
  const numberedPrefix = `b${buildNumber.padStart(4, '0')}`;
  const buildId = process.env.APP_BUILD_ID
    || `${numberedPrefix}-${getBuildTimestamp()}-${getGitShortSha()}${gitWorktreeSuffix}`;
  const buildChannel = getBuildChannel();

  const filesToCopy = ['index.html', 'overlay.html', 'style.css', 'README.md', 'package.json'];

  for (const file of filesToCopy) {
    const src = path.join(root, file);
    try {
      await copyFile(src, path.join(distDir, file));
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn(`Skipping missing file: ${file}`);
      } else {
        throw error;
      }
    }
  }

  const dirsToCopy = ['icons', 'styles', 'src', 'vendor'];
  for (const dir of dirsToCopy) {
    const srcDir = path.join(root, dir);
    try {
      await copyDir(srcDir, path.join(distDir, dir));
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn(`Skipping missing folder: ${dir}`);
      } else {
        throw error;
      }
    }
  }

  const mainEntryPath = path.join(distDir, 'src', 'app', 'main-entry.js');
  let mainEntryContent = await fs.readFile(mainEntryPath, 'utf8');
  mainEntryContent = mainEntryContent.replace(/__APP_VERSION__/g, pkg.version);
  mainEntryContent = mainEntryContent.replace(/__APP_BUILD__/g, buildId);
  mainEntryContent = mainEntryContent.replace(/__APP_CHANNEL__/g, buildChannel);
  await fs.writeFile(mainEntryPath, mainEntryContent, 'utf8');

  console.log(`Built static bundle in ${distDir} (build ${buildId})`);
  console.log(`Build channel: ${buildChannel}`);
  console.log(`Build number source: ${buildNumberSource} -> ${buildNumber}`);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
