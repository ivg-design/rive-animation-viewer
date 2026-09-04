import { execFile as execFileCallback } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
    assertExecutable,
    assertIntegrity,
    fileIntegrity,
    listDirectories,
    listFiles,
} from './integrity.mjs';
import {
    createRuntimeManifest,
    validateRuntimeManifest,
} from './manifest.mjs';
import { inspectNativeBinary } from './platform.mjs';
import {
    canonicalJson,
    fail,
    hostTarget,
    MAX_BINARY,
    MAX_DOCUMENT,
    MAX_MANIFEST,
    validateInventory,
} from './schema.mjs';

const execFile = promisify(execFileCallback);

const readJson = async (file, limit, label) => {
    const stats = await lstat(file)
        .catch((error) => fail(`Cannot inspect ${label}: ${error.message}`));
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > limit) {
        fail(`${label} must be a bounded regular file, not a symlink`);
    }
    try {
        return JSON.parse(await readFile(file, 'utf8'));
    } catch (error) {
        fail(`${label} is not valid JSON: ${error.message}`);
    }
};

const expectedFiles = (inventory) => {
    const files = new Set(['inventory.json', 'manifest.json']);
    for (const binary of inventory.binaries) {
        files.add(binary.file);
        files.add(binary.provenance_file.file);
        binary.license.notice_files.forEach((notice) => files.add(notice.file));
    }
    return [...files].sort();
};

const expectedDirectories = (files) => {
    const directories = new Set();
    for (const file of files) {
        let parent = path.posix.dirname(file);
        while (parent !== '.') {
            directories.add(parent);
            parent = path.posix.dirname(parent);
        }
    }
    return [...directories].sort();
};

const verifyResources = async (directory, inventory, inspectBinary) => {
    for (const binary of inventory.binaries) {
        const executable = path.join(directory, binary.file);
        await assertIntegrity(executable, binary, MAX_BINARY);
        await assertExecutable(executable);
        await inspectBinary(executable, inventory.distribution.target);
        await assertIntegrity(
            path.join(directory, binary.provenance_file.file),
            binary.provenance_file,
            MAX_DOCUMENT,
        );
        for (const notice of binary.license.notice_files) {
            await assertIntegrity(path.join(directory, notice.file), notice, MAX_DOCUMENT);
        }
    }
};

export const verifyStagedDirectory = async (
    directory,
    {
        expectedTarget = hostTarget(),
        inspectBinary = inspectNativeBinary,
    } = {},
) => {
    const root = path.resolve(directory);
    const manifest = validateRuntimeManifest(
        await readJson(path.join(root, 'manifest.json'), MAX_MANIFEST, 'encoder manifest'),
        expectedTarget,
    );
    const inventoryFile = path.join(root, manifest.distribution.inventory_file);
    await assertIntegrity(
        inventoryFile,
        {
            sha256: manifest.distribution.inventory_sha256,
            size_bytes: manifest.distribution.inventory_size_bytes,
        },
        MAX_MANIFEST,
    );
    const inventory = validateInventory(
        await readJson(inventoryFile, MAX_MANIFEST, 'encoder inventory'),
        { expectedTarget },
    );
    const inventoryIntegrity = await fileIntegrity(inventoryFile, MAX_MANIFEST);
    const expectedManifest = createRuntimeManifest(
        inventory,
        inventoryIntegrity.sha256,
        inventoryIntegrity.size_bytes,
    );
    if (canonicalJson(manifest) !== canonicalJson(expectedManifest)) {
        fail('Runtime manifest does not exactly match its approved inventory');
    }
    const actualFiles = await listFiles(root);
    const expected = expectedFiles(inventory);
    if (JSON.stringify(actualFiles) !== JSON.stringify(expected)) {
        fail(`Staged encoder file set differs from inventory: ${actualFiles.join(', ')}`);
    }
    const actualDirectories = await listDirectories(root);
    const directories = expectedDirectories(expected);
    if (JSON.stringify(actualDirectories) !== JSON.stringify(directories)) {
        fail(`Staged encoder directory set differs from inventory: ${actualDirectories.join(', ')}`);
    }
    await verifyResources(root, inventory, inspectBinary);
    return {
        directory: root,
        target: expectedTarget,
        distribution_id: inventory.distribution.id,
        inventory_sha256: inventoryIntegrity.sha256,
        binaries: inventory.binaries.map(({ id, file, version, sha256, size_bytes }) => ({
            id,
            file,
            version,
            sha256: sha256.toLowerCase(),
            size_bytes,
        })),
    };
};

const defaultSignatureVerifier = async (file) => {
    if (process.platform !== 'darwin') return;
    try {
        await execFile('/usr/bin/codesign', ['--verify', '--strict', file], {
            encoding: 'utf8',
            maxBuffer: 4 * 1024 * 1024,
        });
    } catch (error) {
        fail(`Code-signature verification failed for ${file}: ${error.message}`);
    }
};

const defaultNotarizationVerifier = async (app) => {
    for (const [program, args] of [
        ['/usr/bin/xcrun', ['stapler', 'validate', app]],
        ['/usr/sbin/spctl', ['--assess', '--type', 'execute', app]],
    ]) {
        try {
            await execFile(program, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
        } catch (error) {
            fail(`Notarization/Gatekeeper verification failed: ${program}: ${error.message}`);
        }
    }
};

export const verifyBundle = async (
    appPath,
    {
        verifySignature = defaultSignatureVerifier,
        verifyNotarization = defaultNotarizationVerifier,
        inspectBinary = inspectNativeBinary,
        expectedTarget = hostTarget(),
    } = {},
) => {
    if (process.platform !== 'darwin' || path.extname(appPath) !== '.app') {
        fail('Final bundle verification currently requires a macOS .app bundle');
    }
    const app = path.resolve(appPath);
    const resources = path.join(app, 'Contents', 'Resources', 'encoders');
    const receipt = await verifyStagedDirectory(resources, { inspectBinary, expectedTarget });
    for (const binary of receipt.binaries) {
        await verifySignature(path.join(resources, binary.file));
    }
    await verifySignature(app);
    await verifyNotarization(app);
    return { ...receipt, app, signatures_verified: true, notarization_verified: true };
};
