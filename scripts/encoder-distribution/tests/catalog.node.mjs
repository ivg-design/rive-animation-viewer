import assert from 'node:assert/strict';
import test from 'node:test';
import {
    loadReleaseCatalog,
    resolveReleaseTarget,
} from '../acquisition/catalog.mjs';

test('the committed Jellyfin release catalog pins every approved artifact', async () => {
    const catalog = await loadReleaseCatalog();
    assert.equal(
        catalog.release.source.sha256,
        '38fff90f73b3c4f9c3c7270711411a4ec3cbe63b205d4b4a5525bcc532d3d31f',
    );
    assert.deepEqual(
        Object.fromEntries(Object.entries(catalog.targets).map(([target, value]) => [
            target,
            value.sha256,
        ])),
        {
            'aarch64-apple-darwin': '99d689816a41075574928a0b3059101fd454fc58f465c99105a73b5c415ac86d',
            'x86_64-apple-darwin': '943f78e94d2760d3925fc0d9cc15f8329b11dbcdae7b0fd0d225b64e5a1aae29',
            'x86_64-pc-windows-msvc': '113adeb702683c38be40a65d859f8ef7ffb07bae9df16dfb6c3df5ac3d95ef3c',
        },
    );
    assert.equal(catalog.distribution.license_spdx, 'GPL-3.0-or-later');
    assert.equal(catalog.distribution.approval.redistribution_approved, true);
    assert.deepEqual(
        catalog.release.source.license_files.map(({ file }) => file),
        [
            'licenses/COPYING.GPLv3',
            'licenses/FFmpeg-LICENSE.md',
            'licenses/Jellyfin-FFmpeg-debian-copyright',
        ],
    );
    assert.equal(Object.values(catalog.targets).some(({ asset }) => /gifski/i.test(asset)), false);
});

test('RAV_ENCODER_TARGET selects the intended matrix target independently of process.arch', async () => {
    const catalog = await loadReleaseCatalog();
    const selected = resolveReleaseTarget(catalog, undefined, {
        environment: { RAV_ENCODER_TARGET: 'x86_64-apple-darwin' },
        platform: 'darwin',
        arch: 'arm64',
    });
    assert.equal(selected.rustTarget, 'x86_64-apple-darwin');
    assert.equal(selected.distribution_target, 'macos-x86_64');
});
