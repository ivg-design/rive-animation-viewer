import assert from 'node:assert/strict';
import {
    mkdtemp,
    rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { acquireDistribution } from '../acquisition/acquire.mjs';
import { hostRustTarget } from '../acquisition/catalog.mjs';

test('live pinned Jellyfin release acquisition', {
    skip: process.env.RAV_ENCODER_LIVE !== '1',
    timeout: 180_000,
}, async (t) => {
    const target = process.env.RAV_ENCODER_TARGET || hostRustTarget();
    assert.ok(target, 'this host is not in the approved release target matrix');
    const root = await mkdtemp(path.join(os.tmpdir(), 'rav-live-encoder-acquisition-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const receipt = await acquireDistribution({
        target,
        workDirectory: path.join(root, 'work'),
        cacheDirectory: process.env.RAV_ENCODER_CACHE || path.join(root, 'cache'),
        outputDirectory: path.join(root, 'output'),
        macSigningIdentity: process.env.RAV_ENCODER_MAC_SIGNING_IDENTITY,
    });
    assert.equal(receipt.rust_target, target);
    assert.deepEqual(receipt.binaries.map(({ id }) => id), ['ffmpeg', 'ffprobe']);
});
