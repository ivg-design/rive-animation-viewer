#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';

const root = process.cwd();
const distDir = path.join(root, 'dist');

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

  const filesToCopy = [
    'index.html',
    'style.css',
    'app.js',
    'manifest.webmanifest',
    'service-worker.js',
    'README.md'
  ];

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

  const dirsToCopy = ['icons'];
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

  console.log(`Built static bundle in ${distDir}`);
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
