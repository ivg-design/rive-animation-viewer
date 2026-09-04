import assert from 'node:assert/strict';
import {
    readFile,
    writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireDistribution } from '../acquisition/acquire.mjs';
import { validateVersionText } from '../acquisition/inspect.mjs';
import { listFiles } from '../integrity.mjs';
import { createAcquisitionFixture } from './acquisition-fixture.mjs';

const noNativeInspection = async () => {};

const versionRunner = async (file) => {
    const id = path.basename(file).startsWith('ffprobe') ? 'ffprobe' : 'ffmpeg';
    return `${id} version 7.1.4-Jellyfin\nconfiguration: --enable-gpl --enable-version3\n`;
};

const outputBytes = async (root) => Object.fromEntries(await Promise.all(
    (await listFiles(root)).map(async (relative) => [
        relative,
        await readFile(path.join(root, relative)),
    ]),
));

const runFixture = (fixture, suffix) => acquireDistribution({
    target: 'aarch64-apple-darwin',
    workDirectory: path.join(fixture.root, `work-${suffix}`),
    cacheDirectory: path.join(fixture.root, 'cache'),
    outputDirectory: path.join(fixture.root, `output-${suffix}`),
    catalogFile: fixture.catalogFile,
    downloader: fixture.downloader,
    archiveRunner: fixture.archiveRunner,
    inspectBinary: noNativeInspection,
    versionRunner,
    platform: 'darwin',
});

test('offline acquisition is pinned, deterministic, GPL-complete, and cacheable', async (t) => {
    const fixture = await createAcquisitionFixture();
    t.after(fixture.cleanup);
    const first = await runFixture(fixture, 'one');
    const second = await runFixture(fixture, 'two');
    assert.equal(fixture.downloadCount(), 2);
    assert.equal(fixture.archivePrograms.every((program) => program === '/usr/bin/tar'), true);
    assert.equal(first.rust_target, 'aarch64-apple-darwin');
    assert.deepEqual(first.binaries.map(({ id }) => id), ['ffmpeg', 'ffprobe']);
    const firstBytes = await outputBytes(first.directory);
    const secondBytes = await outputBytes(second.directory);
    assert.deepEqual(firstBytes, secondBytes);
    assert.deepEqual(Object.keys(firstBytes), [
        'ffmpeg',
        'ffprobe',
        'inventory.json',
        'licenses/COPYING.GPLv3',
        'licenses/FFmpeg-LICENSE.md',
        'manifest.json',
        'provenance/jellyfin-ffmpeg-v7.1.4-3.json',
    ]);
    const inventory = JSON.parse(firstBytes['inventory.json'].toString('utf8'));
    assert.equal(inventory.binaries.length, 2);
    assert.equal(inventory.binaries[0].license.spdx, 'GPL-3.0-or-later');
    const provenance = JSON.parse(
        firstBytes['provenance/jellyfin-ffmpeg-v7.1.4-3.json'].toString('utf8'),
    );
    assert.deepEqual(provenance.required_configuration, ['--enable-gpl', '--enable-version3']);
    assert.deepEqual(provenance.forbidden_configuration, ['--enable-nonfree']);
});

test('a corrupted cache entry fails closed without touching output', async (t) => {
    const fixture = await createAcquisitionFixture();
    t.after(fixture.cleanup);
    await runFixture(fixture, 'accepted');
    await writeFile(path.join(fixture.root, 'cache', 'mac-arm.tar.xz'), 'tampered');
    await assert.rejects(runFixture(fixture, 'rejected'), /Integrity mismatch/);
    await assert.rejects(readFile(path.join(fixture.root, 'output-rejected', 'manifest.json')));
});

test('nonfree or non-version3 FFmpeg configurations are rejected', () => {
    assert.throws(
        () => validateVersionText(
            'ffmpeg version 7.1.4-Jellyfin\nconfiguration: --enable-gpl --enable-version3 --enable-nonfree',
            'ffmpeg',
            '7.1.4-Jellyfin',
        ),
        /enable-nonfree/,
    );
    assert.throws(
        () => validateVersionText(
            'ffmpeg version 7.1.4-Jellyfin\nconfiguration: --enable-gpl',
            'ffmpeg',
            '7.1.4-Jellyfin',
        ),
        /GPL version3/,
    );
});

test('acquisition refuses work or cache paths inside tracked source', async () => {
    await assert.rejects(
        acquireDistribution({
            target: 'aarch64-apple-darwin',
            workDirectory: path.join(process.cwd(), 'forbidden-encoder-work'),
            cacheDirectory: path.join(os.tmpdir(), 'rav-safe-cache-fixture'),
            outputDirectory: path.join(os.tmpdir(), 'rav-safe-output-fixture'),
        }),
        /outside tracked repository source/,
    );
});

test('mac signing is applied only to the two declared executables', async (t) => {
    const fixture = await createAcquisitionFixture();
    t.after(fixture.cleanup);
    const signed = [];
    await acquireDistribution({
        target: 'aarch64-apple-darwin',
        workDirectory: path.join(fixture.root, 'work-signed'),
        cacheDirectory: path.join(fixture.root, 'cache'),
        outputDirectory: path.join(fixture.root, 'output-signed'),
        catalogFile: fixture.catalogFile,
        downloader: fixture.downloader,
        archiveRunner: fixture.archiveRunner,
        inspectBinary: noNativeInspection,
        versionRunner,
        signer: async (file, identity) => signed.push([path.basename(file), identity]),
        macSigningIdentity: 'Developer ID Application: Fixture',
        platform: 'darwin',
    });
    assert.deepEqual(signed, [
        ['ffmpeg', 'Developer ID Application: Fixture'],
        ['ffprobe', 'Developer ID Application: Fixture'],
    ]);
});
