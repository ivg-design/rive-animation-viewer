import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    DEFAULT_TAURI_CONFIG_PATH,
    loadUpdaterPublicKey,
    verifyUpdaterArtifact,
    verifyUpdaterArtifacts,
} from '../../../scripts/verify-updater-signatures.mjs';

const TEST_PUBLIC_KEY_RECORD = 'RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3';
const TEST_PUBLIC_KEY = [
    'untrusted comment: minisign public key E7620F1842B4E81F',
    TEST_PUBLIC_KEY_RECORD,
].join('\n');
const TEST_SIGNATURE = [
    'untrusted comment: signature from minisign secret key',
    'RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=',
    'trusted comment: timestamp:1556193335\tfile:test',
    'y/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==',
].join('\n');

function createFixture({ count = 1 } = {}) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rav-updater-signatures-'));
    const configPath = path.join(tempDir, 'tauri.conf.json');
    const artifactPaths = [];

    fs.writeFileSync(configPath, JSON.stringify({
        plugins: {
            updater: {
                pubkey: Buffer.from(TEST_PUBLIC_KEY, 'utf8').toString('base64'),
            },
        },
    }));

    for (let index = 0; index < count; index += 1) {
        const artifactPath = path.join(tempDir, `artifact-${index}.bin`);
        fs.writeFileSync(artifactPath, Buffer.from('test'));
        fs.writeFileSync(
            `${artifactPath}.sig`,
            `${Buffer.from(TEST_SIGNATURE, 'utf8').toString('base64')}\n`,
        );
        artifactPaths.push(artifactPath);
    }

    return {
        artifactPaths,
        cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
        configPath,
    };
}

describe('verify-updater-signatures', () => {
    it('loads the updater public key embedded in the real Tauri config', () => {
        const publicKey = loadUpdaterPublicKey(DEFAULT_TAURI_CONFIG_PATH);
        expect(publicKey.keyIdHex).toBe('0B11AD0196737FCE');
    });

    it('verifies every requested payload against its sibling Tauri signature', async () => {
        const fixture = createFixture({ count: 2 });

        try {
            const results = await verifyUpdaterArtifacts(fixture.artifactPaths, {
                configPath: fixture.configPath,
            });

            expect(results).toHaveLength(2);
            expect(results).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        byteLength: 4,
                        keyId: 'E7620F1842B4E81F',
                        mode: 'prehashed',
                    }),
                ]),
            );
        } finally {
            fixture.cleanup();
        }
    });

    it('rejects a one-byte payload change', async () => {
        const fixture = createFixture();
        const [artifactPath] = fixture.artifactPaths;
        fs.appendFileSync(artifactPath, '\n');

        try {
            await expect(verifyUpdaterArtifact({
                artifactPath,
                configPath: fixture.configPath,
            })).rejects.toThrow(/does not match artifact bytes/);
        } finally {
            fixture.cleanup();
        }
    });

    it('rejects a trusted-comment change even when the payload signature is intact', async () => {
        const fixture = createFixture();
        const [artifactPath] = fixture.artifactPaths;
        const tamperedSignature = TEST_SIGNATURE.replace('file:test', 'file:tampered');
        fs.writeFileSync(
            `${artifactPath}.sig`,
            Buffer.from(tamperedSignature, 'utf8').toString('base64'),
        );

        try {
            await expect(verifyUpdaterArtifact({
                artifactPath,
                configPath: fixture.configPath,
            })).rejects.toThrow(/trusted comment is invalid/);
        } finally {
            fixture.cleanup();
        }
    });

    it('rejects a signature made by a different key than the embedded key', async () => {
        const fixture = createFixture();
        const [artifactPath] = fixture.artifactPaths;

        try {
            await expect(verifyUpdaterArtifact({
                artifactPath,
                configPath: DEFAULT_TAURI_CONFIG_PATH,
            })).rejects.toThrow(/does not match the embedded Tauri updater key/);
        } finally {
            fixture.cleanup();
        }
    });
});
