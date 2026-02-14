#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = process.cwd();
const distDir = path.join(root, 'dist');
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

function getBuildTimestamp() {
  const date = new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}${month}${day}-${hour}${minute}`;
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
  const buildId = process.env.APP_BUILD_ID || `${getBuildTimestamp()}-${getGitShortSha()}`;

  const filesToCopy = ['index.html', 'style.css', 'app.js', 'vm-explorer-snippet.js', 'README.md', 'package.json'];

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
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
