#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = process.cwd();
const distDir = path.join(root, 'dist');
const buildCounterFile = path.join(root, '.cache', 'build-counter.txt');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));

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
  const buildId = process.env.APP_BUILD_ID || `${numberedPrefix}-${getBuildTimestamp()}-${getGitShortSha()}`;

  const filesToCopy = ['index.html', 'style.css', 'app.js', 'mcp-bridge.js', 'vm-explorer-snippet.js', 'README.md', 'package.json'];

  for (const file of filesToCopy) {
    const src = path.join(root, file);
    try {
      if (file === 'app.js') {
        let content = await fs.readFile(src, 'utf8');
        content = content.replace(/__APP_VERSION__/g, pkg.version);
        content = content.replace(/__APP_BUILD__/g, buildId);
        const destPath = path.join(distDir, file);
        await ensureDir(path.dirname(destPath));
        await fs.writeFile(destPath, content);
      } else {
        await copyFile(src, path.join(distDir, file));
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn(`Skipping missing file: ${file}`);
      } else {
        throw error;
      }
    }
  }

  const dirsToCopy = ['icons', 'vendor'];
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

  console.log(`Built static bundle in ${distDir} (build ${buildId})`);
  console.log(`Build number source: ${buildNumberSource} -> ${buildNumber}`);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
