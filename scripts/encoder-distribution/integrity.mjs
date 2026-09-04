import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import {
    chmod,
    copyFile,
    lstat,
    mkdir,
    readFile,
    realpath,
    readdir,
} from 'node:fs/promises';
import path from 'node:path';
import {
    fail,
    MAX_BINARY,
    MAX_DOCUMENT,
    PACKAGE_MANAGER_ROOTS,
    validRelative,
} from './schema.mjs';

export const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex');

export const fileIntegrity = async (file, limit) => {
    const stats = await lstat(file).catch((error) => fail(`Cannot inspect ${file}: ${error.message}`));
    if (!stats.isFile() || stats.isSymbolicLink()) {
        fail(`Resource must be a regular file, not a symlink: ${file}`);
    }
    if (stats.size <= 0 || stats.size > limit) fail(`Resource size is outside its bound: ${file}`);
    return { sha256: hashBytes(await readFile(file)), size_bytes: stats.size };
};

export const assertIntegrity = async (file, expected, limit) => {
    const actual = await fileIntegrity(file, limit);
    if (actual.size_bytes !== expected.size_bytes || actual.sha256 !== expected.sha256.toLowerCase()) {
        fail(`Integrity mismatch for ${file}`);
    }
    return actual;
};

export const assertExecutable = async (file) => {
    const stats = await lstat(file)
        .catch((error) => fail(`Cannot inspect executable ${file}: ${error.message}`));
    if (!stats.isFile() || stats.isSymbolicLink()) {
        fail(`Encoder executable must be a regular file: ${file}`);
    }
    if (process.platform !== 'win32' && ((stats.mode & 0o111) === 0 || (stats.mode & 0o002) !== 0)) {
        fail(`Encoder must be executable and not world-writable: ${file}`);
    }
};

export const assertApprovedSourceRoot = async (sourceDirectory) => {
    const resolved = path.resolve(sourceDirectory);
    if (PACKAGE_MANAGER_ROOTS.some((root) => resolved === root || resolved.startsWith(`${root}/`))) {
        fail(`Package-manager installations are forbidden redistribution inputs: ${resolved}`);
    }
    const canonical = await realpath(resolved)
        .catch((error) => fail(`Cannot resolve source directory: ${error.message}`));
    if (PACKAGE_MANAGER_ROOTS.some((root) => canonical === root || canonical.startsWith(`${root}/`))) {
        fail(`Package-manager installations are forbidden redistribution inputs: ${canonical}`);
    }
    return canonical;
};

const sourcePath = (sourceRoot, relative, label) => {
    if (!validRelative(relative)) fail(`${label} is not a safe relative path`);
    const candidate = path.resolve(sourceRoot, relative);
    if (candidate !== sourceRoot && !candidate.startsWith(`${sourceRoot}${path.sep}`)) {
        fail(`${label} escapes the approved source directory`);
    }
    return candidate;
};

export const copyPinned = async (
    sourceRoot,
    source,
    destinationRoot,
    destination,
    expected,
    executable,
) => {
    const from = sourcePath(sourceRoot, source, 'source_file');
    const canonicalFrom = await realpath(from)
        .catch((error) => fail(`Cannot resolve approved source file: ${error.message}`));
    if (canonicalFrom !== from) {
        fail(`Approved source paths may not traverse symlinks: ${source}`);
    }
    await assertIntegrity(from, expected, executable ? MAX_BINARY : MAX_DOCUMENT);
    const to = path.join(destinationRoot, destination);
    await mkdir(path.dirname(to), { recursive: true, mode: 0o755 });
    await copyFile(from, to, fsConstants.COPYFILE_EXCL);
    await chmod(to, executable ? 0o755 : 0o644);
    await assertIntegrity(to, expected, executable ? MAX_BINARY : MAX_DOCUMENT);
};

export const listFiles = async (root, relative = '') => {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
        const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
        if (entry.isSymbolicLink()) fail(`Staged encoder resources contain a symlink: ${child}`);
        if (entry.isDirectory()) result.push(...await listFiles(root, child));
        else if (entry.isFile()) result.push(child);
        else fail(`Staged encoder resources contain an unsupported entry: ${child}`);
    }
    return result.sort();
};

export const listDirectories = async (root, relative = '') => {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    const result = [];
    for (const entry of entries) {
        const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
        if (entry.isSymbolicLink()) fail(`Staged encoder resources contain a symlink: ${child}`);
        if (entry.isDirectory()) {
            result.push(child, ...await listDirectories(root, child));
        } else if (!entry.isFile()) {
            fail(`Staged encoder resources contain an unsupported entry: ${child}`);
        }
    }
    return result.sort();
};
