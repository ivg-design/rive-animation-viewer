import { randomUUID } from 'node:crypto';
import { constants as fsConstants, createWriteStream } from 'node:fs';
import {
    copyFile,
    lstat,
    mkdir,
    rm,
} from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertIntegrity } from '../integrity.mjs';
import { fail, MAX_BINARY, validRelative } from '../schema.mjs';

const responseFor = (url, redirects = 0) => new Promise((resolve, reject) => {
    if (redirects > 5) {
        reject(new Error('too many redirects'));
        return;
    }
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
        reject(new Error(`refusing non-HTTPS URL ${url}`));
        return;
    }
    const request = https.get(parsed, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.resume();
            const next = new URL(response.headers.location, parsed).href;
            responseFor(next, redirects + 1).then(resolve, reject);
            return;
        }
        if (response.statusCode !== 200) {
            response.resume();
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
        }
        resolve(response);
    });
    request.setTimeout(60_000, () => request.destroy(new Error('download timed out')));
    request.on('error', reject);
});

export const downloadHttps = async (url, destination, expectedSize) => {
    const response = await responseFor(url).catch((error) => fail(`Download failed for ${url}: ${error.message}`));
    const declared = Number(response.headers['content-length']);
    if (Number.isFinite(declared) && declared !== expectedSize) {
        response.resume();
        fail(`Download size header mismatch for ${url}`);
    }
    let received = 0;
    const meter = new Transform({
        transform(chunk, _encoding, callback) {
            received += chunk.length;
            if (received > expectedSize) callback(new Error('download exceeded pinned size'));
            else callback(null, chunk);
        },
    });
    try {
        await pipeline(response, meter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
    } catch (error) {
        await rm(destination, { force: true });
        fail(`Download failed for ${url}: ${error.message}`);
    }
    if (received !== expectedSize) {
        await rm(destination, { force: true });
        fail(`Downloaded byte count differs from pin for ${url}`);
    }
};

const ensureCacheDirectory = async (directory) => {
    if (!path.isAbsolute(directory)) fail('Cache directory must be an absolute path');
    await mkdir(directory, { recursive: true, mode: 0o755 });
    const stats = await lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
        fail(`Cache path must be a real directory: ${directory}`);
    }
};

export const acquirePinnedFile = async ({
    url,
    filename,
    sha256,
    size_bytes: sizeBytes,
    cacheDirectory,
    downloader = downloadHttps,
}) => {
    if (!validRelative(filename, true)) fail(`Unsafe cache filename: ${filename}`);
    await ensureCacheDirectory(cacheDirectory);
    const cached = path.join(cacheDirectory, filename);
    try {
        await lstat(cached);
        await assertIntegrity(cached, { sha256, size_bytes: sizeBytes }, MAX_BINARY);
        return cached;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const temporary = path.join(cacheDirectory, `.${filename}.partial-${process.pid}-${randomUUID()}`);
    await downloader(url, temporary, sizeBytes);
    await assertIntegrity(temporary, { sha256, size_bytes: sizeBytes }, MAX_BINARY);
    try {
        await copyFile(temporary, cached, fsConstants.COPYFILE_EXCL);
    } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    } finally {
        await rm(temporary, { force: true });
    }
    await assertIntegrity(cached, { sha256, size_bytes: sizeBytes }, MAX_BINARY);
    return cached;
};
