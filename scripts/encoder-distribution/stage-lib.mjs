import {
    chmod,
    mkdir,
    mkdtemp,
    readFile,
    rename,
    rm,
    utimes,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
    assertApprovedSourceRoot,
    copyPinned,
    fileIntegrity,
    listDirectories,
} from './integrity.mjs';
import { createRuntimeManifest } from './manifest.mjs';
import { inspectNativeBinary } from './platform.mjs';
import {
    canonicalJson,
    fail,
    hostTarget,
    MAX_MANIFEST,
    validateInventory,
} from './schema.mjs';
import { verifyStagedDirectory } from './verify.mjs';

const FIXED_TIME = new Date('2000-01-01T00:00:00.000Z');

const readInventory = async (file, expectedTarget) => {
    const bytes = await readFile(file)
        .catch((error) => fail(`Cannot read encoder inventory: ${error.message}`));
    if (bytes.length === 0 || bytes.length > MAX_MANIFEST) {
        fail('Encoder inventory is empty or exceeds its size bound');
    }
    try {
        return validateInventory(JSON.parse(bytes), { expectedTarget });
    } catch (error) {
        if (error.name === 'DistributionError') throw error;
        fail(`Encoder inventory is not valid JSON: ${error.message}`);
    }
};

const sortedInventory = (inventory) => ({
    ...inventory,
    binaries: [...inventory.binaries]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((binary) => ({
            ...binary,
            license: {
                ...binary.license,
                notice_files: [...binary.license.notice_files]
                    .sort((left, right) => left.file.localeCompare(right.file)),
            },
        })),
});

const copyDocument = async (sourceRoot, staging, entry) => {
    await copyPinned(sourceRoot, entry.source_file, staging, entry.file, entry, false);
};

const copyResources = async (sourceRoot, staging, inventory, inspectBinary) => {
    const documents = new Map();
    for (const binary of inventory.binaries) {
        await copyPinned(sourceRoot, binary.source_file, staging, binary.file, binary, true);
        await inspectBinary(path.join(staging, binary.file), inventory.distribution.target);
        for (const document of [binary.provenance_file, ...binary.license.notice_files]) {
            const existing = documents.get(document.file);
            const identity = `${document.source_file}:${document.sha256}:${document.size_bytes}`;
            if (existing && existing !== identity) {
                fail(`Conflicting inventory entries target ${document.file}`);
            }
            if (!existing) {
                await copyDocument(sourceRoot, staging, document);
                documents.set(document.file, identity);
            }
        }
    }
};

const normalizeTimestamps = async (root, receipt) => {
    const files = ['inventory.json', 'manifest.json'];
    for (const binary of receipt.binaries) files.push(binary.file);
    const inventory = JSON.parse(await readFile(path.join(root, 'inventory.json'), 'utf8'));
    for (const binary of inventory.binaries) {
        files.push(binary.provenance_file.file);
        binary.license.notice_files.forEach((notice) => files.push(notice.file));
    }
    for (const relative of new Set(files)) {
        await utimes(path.join(root, relative), FIXED_TIME, FIXED_TIME);
    }
    const directories = await listDirectories(root);
    for (const relative of directories.reverse()) {
        await utimes(path.join(root, relative), FIXED_TIME, FIXED_TIME);
    }
    await utimes(root, FIXED_TIME, FIXED_TIME);
};

const publishAtomically = async (staging, output) => {
    const backup = `${output}.previous-${process.pid}`;
    let hadOutput = false;
    try {
        await rename(output, backup);
        hadOutput = true;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    try {
        await rename(staging, output);
        if (hadOutput) await rm(backup, { recursive: true, force: true });
    } catch (error) {
        if (hadOutput) await rename(backup, output).catch(() => {});
        throw error;
    }
};

export const stageDistribution = async ({
    inventoryFile,
    sourceDirectory,
    outputDirectory,
    expectedTarget = hostTarget(),
    inspectBinary = inspectNativeBinary,
}) => {
    if (!inventoryFile || !sourceDirectory || !outputDirectory) {
        fail('Staging requires inventoryFile, sourceDirectory, and outputDirectory');
    }
    const sourceRoot = await assertApprovedSourceRoot(sourceDirectory);
    const inventory = sortedInventory(await readInventory(inventoryFile, expectedTarget));
    const output = path.resolve(outputDirectory);
    const parent = path.dirname(output);
    await mkdir(parent, { recursive: true, mode: 0o755 });
    const staging = await mkdtemp(path.join(parent, `.${path.basename(output)}.staging-`));
    try {
        await copyResources(sourceRoot, staging, inventory, inspectBinary);
        const inventoryText = canonicalJson(inventory);
        await writeFile(path.join(staging, 'inventory.json'), inventoryText, { mode: 0o644, flag: 'wx' });
        const integrity = await fileIntegrity(path.join(staging, 'inventory.json'), MAX_MANIFEST);
        const manifest = createRuntimeManifest(inventory, integrity.sha256, integrity.size_bytes);
        await writeFile(path.join(staging, 'manifest.json'), canonicalJson(manifest), {
            mode: 0o644,
            flag: 'wx',
        });
        await chmod(staging, 0o755);
        let receipt = await verifyStagedDirectory(staging, { expectedTarget, inspectBinary });
        await normalizeTimestamps(staging, receipt);
        receipt = await verifyStagedDirectory(staging, { expectedTarget, inspectBinary });
        await publishAtomically(staging, output);
        return { ...receipt, directory: output };
    } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
    }
};
