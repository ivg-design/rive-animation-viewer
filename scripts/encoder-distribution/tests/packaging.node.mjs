import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { listFiles } from '../integrity.mjs';
import {
    DistributionError,
    stageDistribution,
    validateInventory,
    verifyBundle,
    verifyStagedDirectory,
} from '../lib.mjs';
import { createFixture } from './staging-fixture.mjs';

const noNativeInspection = async () => {};

const bytesByPath = async (root) => Object.fromEntries(await Promise.all(
    (await listFiles(root)).map(async (relative) => [relative, await readFile(path.join(root, relative))]),
));

test('staging is deterministic, exact, hash verified, and independently verifiable', async (t) => {
    const fixture = await createFixture();
    t.after(fixture.cleanup);
    const first = path.join(fixture.root, 'out-one');
    const second = path.join(fixture.root, 'out-two');
    const options = {
        inventoryFile: fixture.inventoryFile,
        sourceDirectory: fixture.source,
        inspectBinary: noNativeInspection,
    };
    const firstReceipt = await stageDistribution({ ...options, outputDirectory: first });
    const secondReceipt = await stageDistribution({ ...options, outputDirectory: second });
    assert.deepEqual(firstReceipt.binaries.map(({ file }) => file), ['ffmpeg', 'ffprobe']);
    assert.equal(firstReceipt.inventory_sha256, secondReceipt.inventory_sha256);
    const firstBytes = await bytesByPath(first);
    const secondBytes = await bytesByPath(second);
    assert.deepEqual(Object.keys(firstBytes), [
        'ffmpeg',
        'ffprobe',
        'inventory.json',
        'licenses/NOTICE.txt',
        'manifest.json',
        'provenance/build.json',
    ]);
    assert.deepEqual(firstBytes, secondBytes);
    for (const relative of Object.keys(firstBytes)) {
        assert.equal((await lstat(path.join(first, relative))).mtime.toISOString(), '2000-01-01T00:00:00.000Z');
    }
    const verified = await verifyStagedDirectory(first, { inspectBinary: noNativeInspection });
    assert.equal(verified.inventory_sha256, firstReceipt.inventory_sha256);
});

test('approval, package-manager inputs, symlinks, tampering, and extras fail closed', async (t) => {
    const fixture = await createFixture();
    t.after(fixture.cleanup);
    const output = path.join(fixture.root, 'encoders');
    fixture.inventory.distribution.approval.redistribution_approved = false;
    await fixture.saveInventory();
    await assert.rejects(
        stageDistribution({
            inventoryFile: fixture.inventoryFile,
            sourceDirectory: fixture.source,
            outputDirectory: output,
            inspectBinary: noNativeInspection,
        }),
        /Redistribution approval/,
    );
    await assert.rejects(lstat(output), { code: 'ENOENT' });
    await assert.rejects(
        stageDistribution({
            inventoryFile: fixture.inventoryFile,
            sourceDirectory: '/opt/homebrew/bin',
            outputDirectory: output,
            inspectBinary: noNativeInspection,
        }),
        /Package-manager installations are forbidden/,
    );

    fixture.inventory.distribution.approval.redistribution_approved = true;
    await fixture.saveInventory();
    await stageDistribution({
        inventoryFile: fixture.inventoryFile,
        sourceDirectory: fixture.source,
        outputDirectory: output,
        inspectBinary: noNativeInspection,
    });
    await writeFile(path.join(output, 'ffmpeg'), 'tampered');
    await assert.rejects(
        verifyStagedDirectory(output, { inspectBinary: noNativeInspection }),
        /Integrity mismatch/,
    );

    await stageDistribution({
        inventoryFile: fixture.inventoryFile,
        sourceDirectory: fixture.source,
        outputDirectory: output,
        inspectBinary: noNativeInspection,
    });
    await chmod(path.join(output, 'ffmpeg'), 0o644);
    await assert.rejects(
        verifyStagedDirectory(output, { inspectBinary: noNativeInspection }),
        /must be executable/,
    );

    await stageDistribution({
        inventoryFile: fixture.inventoryFile,
        sourceDirectory: fixture.source,
        outputDirectory: output,
        inspectBinary: noNativeInspection,
    });
    await mkdir(path.join(output, 'unexpected-empty'));
    await assert.rejects(
        verifyStagedDirectory(output, { inspectBinary: noNativeInspection }),
        /directory set differs/,
    );

    await stageDistribution({
        inventoryFile: fixture.inventoryFile,
        sourceDirectory: fixture.source,
        outputDirectory: output,
        inspectBinary: noNativeInspection,
    });
    await writeFile(path.join(output, 'unexpected.txt'), 'extra');
    await assert.rejects(
        verifyStagedDirectory(output, { inspectBinary: noNativeInspection }),
        /file set differs/,
    );

    const original = path.join(fixture.source, 'bin/ffmpeg');
    const moved = path.join(fixture.source, 'bin/ffmpeg-real');
    await rename(original, moved);
    await symlink(moved, original);
    await assert.rejects(
        stageDistribution({
            inventoryFile: fixture.inventoryFile,
            sourceDirectory: fixture.source,
            outputDirectory: path.join(fixture.root, 'symlink-output'),
            inspectBinary: noNativeInspection,
        }),
        /symlinks/,
    );
});

test('the committed inventory template cannot authorize a production bundle', async () => {
    const template = JSON.parse(await readFile(new URL(
        '../../../src-tauri/encoder-distribution/inventory.template.json',
        import.meta.url,
    )));
    assert.throws(() => validateInventory(template), DistributionError);
});

test('production inventories reject gifski', async (t) => {
    const fixture = await createFixture();
    t.after(fixture.cleanup);
    fixture.inventory.binaries.push({
        ...fixture.inventory.binaries[0],
        id: 'gifski',
        source_file: 'bin/gifski',
        file: 'gifski',
    });
    assert.throws(
        () => validateInventory(fixture.inventory),
        /exactly ffmpeg and ffprobe/,
    );
});

test('a failed replacement retains the previously accepted output', async (t) => {
    const fixture = await createFixture();
    t.after(fixture.cleanup);
    const output = path.join(fixture.root, 'encoders');
    await mkdir(output);
    await writeFile(path.join(output, 'sentinel'), 'accepted');
    await writeFile(path.join(fixture.source, 'bin/ffmpeg'), 'changed after inventory approval');
    await assert.rejects(
        stageDistribution({
            inventoryFile: fixture.inventoryFile,
            sourceDirectory: fixture.source,
            outputDirectory: output,
            inspectBinary: noNativeInspection,
        }),
        DistributionError,
    );
    assert.equal(await readFile(path.join(output, 'sentinel'), 'utf8'), 'accepted');
});

test('final macOS bundle verification covers every encoder and the application', {
    skip: process.platform !== 'darwin',
}, async (t) => {
    const fixture = await createFixture();
    t.after(fixture.cleanup);
    const app = path.join(fixture.root, 'RAV.app');
    const resources = path.join(app, 'Contents/Resources/encoders');
    await stageDistribution({
        inventoryFile: fixture.inventoryFile,
        sourceDirectory: fixture.source,
        outputDirectory: resources,
        inspectBinary: noNativeInspection,
    });
    const signed = [];
    const notarized = [];
    const receipt = await verifyBundle(app, {
        inspectBinary: noNativeInspection,
        verifySignature: async (file) => signed.push(file),
        verifyNotarization: async (file) => notarized.push(file),
    });
    assert.equal(receipt.signatures_verified, true);
    assert.equal(receipt.notarization_verified, true);
    assert.deepEqual(signed, [
        path.join(resources, 'ffmpeg'),
        path.join(resources, 'ffprobe'),
        app,
    ]);
    assert.deepEqual(notarized, [app]);
});
