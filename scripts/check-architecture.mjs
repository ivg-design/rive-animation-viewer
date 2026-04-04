import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '..');
const configPath = path.join(repoRoot, 'architecture-budget.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const sourceExtensions = new Set(config.sourceExtensions || []);
const defaultMaxLines = Number(config.defaultMaxLines || 400);
const recommendSubgroupAt = Number(config.recommendSubgroupAt || 8);
const maxDirectSourceFilesPerFolder = Number(config.maxDirectSourceFilesPerFolder || 10);
const includeRoots = Array.isArray(config.includeRoots) ? config.includeRoots : [];
const excludePrefixes = Array.isArray(config.excludePrefixes) ? config.excludePrefixes : [];
const grandfatheredMaxLines = config.grandfatheredMaxLines || {};
const folderRoots = Array.isArray(config.folderRoots) ? config.folderRoots : [];

function toPosixRelative(filePath) {
    return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function isExcluded(relativePath) {
    return excludePrefixes.some((prefix) => relativePath === prefix || relativePath.startsWith(`${prefix}/`));
}

function isSourceFile(relativePath) {
    return sourceExtensions.has(path.extname(relativePath));
}

function countLines(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.length) {
        return 0;
    }
    return content.split(/\r?\n/).length;
}

function collectSourceFiles(entryPath, found = new Set()) {
    const stats = fs.statSync(entryPath);
    if (stats.isFile()) {
        const relativePath = toPosixRelative(entryPath);
        if (!isExcluded(relativePath) && isSourceFile(relativePath)) {
            found.add(relativePath);
        }
        return found;
    }

    for (const dirent of fs.readdirSync(entryPath, { withFileTypes: true })) {
        const absoluteChildPath = path.join(entryPath, dirent.name);
        const relativeChildPath = toPosixRelative(absoluteChildPath);
        if (isExcluded(relativeChildPath)) {
            continue;
        }
        if (dirent.isDirectory()) {
            collectSourceFiles(absoluteChildPath, found);
            continue;
        }
        if (dirent.isFile() && isSourceFile(relativeChildPath)) {
            found.add(relativeChildPath);
        }
    }

    return found;
}

function collectDirectories(rootPath, found = new Set()) {
    for (const dirent of fs.readdirSync(rootPath, { withFileTypes: true })) {
        if (!dirent.isDirectory()) {
            continue;
        }
        const absoluteChildPath = path.join(rootPath, dirent.name);
        const relativeChildPath = toPosixRelative(absoluteChildPath);
        if (isExcluded(relativeChildPath)) {
            continue;
        }
        found.add(relativeChildPath);
        collectDirectories(absoluteChildPath, found);
    }
    return found;
}

const files = new Set();
for (const includeRoot of includeRoots) {
    const absolutePath = path.join(repoRoot, includeRoot);
    if (!fs.existsSync(absolutePath)) {
        continue;
    }
    collectSourceFiles(absolutePath, files);
}

const failures = [];
const warnings = [];

for (const relativePath of [...files].sort()) {
    const absolutePath = path.join(repoRoot, relativePath);
    const lineCount = countLines(absolutePath);
    const maxLines = Number(grandfatheredMaxLines[relativePath] || defaultMaxLines);

    if (lineCount > maxLines) {
        const budgetNote = relativePath in grandfatheredMaxLines
            ? `grandfathered cap ${maxLines}`
            : `default cap ${defaultMaxLines}`;
        failures.push(`${relativePath}: ${lineCount} lines (${budgetNote})`);
    }
}

for (const folderRoot of folderRoots) {
    const absoluteRoot = path.join(repoRoot, folderRoot);
    if (!fs.existsSync(absoluteRoot) || !fs.statSync(absoluteRoot).isDirectory()) {
        continue;
    }
    const directories = new Set([toPosixRelative(absoluteRoot), ...collectDirectories(absoluteRoot)]);
    for (const relativeDir of [...directories].sort()) {
        const absoluteDir = path.join(repoRoot, relativeDir);
        const directSourceFiles = fs.readdirSync(absoluteDir, { withFileTypes: true })
            .filter((dirent) => dirent.isFile())
            .map((dirent) => path.posix.join(relativeDir, dirent.name))
            .filter((relativePath) => !isExcluded(relativePath) && isSourceFile(relativePath));
        if (directSourceFiles.length > maxDirectSourceFilesPerFolder) {
            failures.push(`${relativeDir}: ${directSourceFiles.length} direct source files (folder cap ${maxDirectSourceFilesPerFolder})`);
            continue;
        }
        if (directSourceFiles.length >= recommendSubgroupAt) {
            warnings.push(`${relativeDir}: ${directSourceFiles.length} direct source files (create subgroup folders before exceeding ${maxDirectSourceFilesPerFolder})`);
        }
    }
}

if (warnings.length) {
    console.log('Architecture warnings:');
    warnings.forEach((warning) => console.log(`  - ${warning}`));
}

if (failures.length) {
    console.error('Architecture budget failed:');
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exit(1);
}

console.log(`Architecture budget passed for ${files.size} source files.`);
