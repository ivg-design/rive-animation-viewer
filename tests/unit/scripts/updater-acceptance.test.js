import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    createLoopbackUpdaterManifest,
    createUpdaterStagingLedger,
    expectedUpdaterAssetNames,
    sha256File,
    verifyUpdaterAcceptanceReceipt,
    verifyUpdaterStagingLedger,
} from '../../../scripts/updater-acceptance-lib.mjs';

const VERSION = '9.8.7';
const COMMIT = 'a'.repeat(40);
const PUBLIC_KEY = [
    'untrusted comment: minisign public key E7620F1842B4E81F',
    'RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3',
].join('\n');
const SIGNATURE = [
    'untrusted comment: signature from minisign secret key',
    'RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=',
    'trusted comment: timestamp:1556193335\tfile:test',
    'y/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==',
].join('\n');

function createFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rav-updater-acceptance-test-'));
    const assetDir = path.join(root, 'assets');
    const configPath = path.join(root, 'tauri.conf.json');
    const releaseFile = path.join(root, 'release.json');
    const ledgerPath = path.join(assetDir, 'updater-staging-ledger.json');
    fs.mkdirSync(assetDir);
    fs.writeFileSync(configPath, JSON.stringify({
        version: VERSION,
        plugins: { updater: { pubkey: Buffer.from(PUBLIC_KEY).toString('base64') } },
    }));
    fs.writeFileSync(releaseFile, JSON.stringify({
        isDraft: true,
        tagName: `v${VERSION}`,
        createdAt: '2030-01-02T03:04:05.000Z',
    }));

    const manifest = {
        version: VERSION,
        platforms: {
            'darwin-aarch64': { signature: 'signed', url: 'https://example.invalid/arm' },
            'darwin-aarch64-app': { signature: 'signed', url: 'https://example.invalid/arm' },
        },
    };
    for (const name of expectedUpdaterAssetNames(VERSION)) {
        if (name === 'latest.json') {
            fs.writeFileSync(path.join(assetDir, name), `${JSON.stringify(manifest)}\n`);
        } else if (name.endsWith('.sig')) {
            fs.writeFileSync(path.join(assetDir, name), Buffer.from(SIGNATURE).toString('base64'));
        } else {
            fs.writeFileSync(path.join(assetDir, name), 'test');
        }
    }
    return {
        assetDir,
        cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
        configPath,
        ledgerPath,
        releaseFile,
        root,
    };
}

async function createLedger(fixture) {
    return createUpdaterStagingLedger({
        assetDir: fixture.assetDir,
        commit: COMMIT,
        configPath: fixture.configPath,
        output: fixture.ledgerPath,
        releaseFile: fixture.releaseFile,
        releaseId: '1234',
        repository: 'owner/repo',
        version: VERSION,
    });
}

describe('updater acceptance provenance', () => {
    it('creates and re-verifies a byte-exact signed private-draft ledger', async () => {
        const fixture = createFixture();
        try {
            const ledger = await createLedger(fixture);
            expect(ledger.assets).toHaveLength(11);
            await expect(verifyUpdaterStagingLedger({
                assetDir: fixture.assetDir,
                configPath: fixture.configPath,
                expectedCommit: COMMIT,
                expectedReleaseId: '1234',
                expectedRepository: 'owner/repo',
                ledgerPath: fixture.ledgerPath,
            })).resolves.toMatchObject({ candidateCommit: COMMIT, version: VERSION });
        } finally {
            fixture.cleanup();
        }
    });

    it('rejects any payload drift after staging', async () => {
        const fixture = createFixture();
        try {
            await createLedger(fixture);
            fs.appendFileSync(path.join(fixture.assetDir, 'Rive.Animation.Viewer_aarch64.app.tar.gz'), '!');
            await expect(verifyUpdaterStagingLedger({
                assetDir: fixture.assetDir,
                configPath: fixture.configPath,
                expectedCommit: COMMIT,
                expectedReleaseId: '1234',
                expectedRepository: 'owner/repo',
                ledgerPath: fixture.ledgerPath,
            })).rejects.toThrow(/bytes changed/);
        } finally {
            fixture.cleanup();
        }
    });

    it('rewrites only selected signed platforms to a tokenized loopback endpoint', () => {
        const fixture = createFixture();
        try {
            const output = path.join(fixture.root, 'local.json');
            const token = 'a'.repeat(48);
            const manifest = createLoopbackUpdaterManifest({
                baseUrl: `http://127.0.0.1:43991/${token}`,
                canonicalManifestPath: path.join(fixture.assetDir, 'latest.json'),
                output,
                payloadName: 'Rive.Animation.Viewer_aarch64.app.tar.gz',
                platformKeys: ['darwin-aarch64', 'darwin-aarch64-app'],
            });
            expect(manifest.platforms['darwin-aarch64'].signature).toBe('signed');
            expect(manifest.platforms['darwin-aarch64'].url)
                .toBe(`http://127.0.0.1:43991/${token}/payload/Rive.Animation.Viewer_aarch64.app.tar.gz`);
            expect(() => createLoopbackUpdaterManifest({
                baseUrl: 'https://example.com:443/token',
                canonicalManifestPath: path.join(fixture.assetDir, 'latest.json'),
                output,
                payloadName: 'payload',
                platformKeys: ['darwin-aarch64'],
            })).toThrow(/loopback/);
        } finally {
            fixture.cleanup();
        }
    });

    it('binds a passing acceptance receipt to the exact ledger and payload', async () => {
        const fixture = createFixture();
        try {
            const ledger = await createLedger(fixture);
            const receiptPath = path.join(fixture.root, 'receipt.json');
            const payload = ledger.assets.find((asset) => asset.name === 'Rive.Animation.Viewer_aarch64.app.tar.gz');
            const manifest = ledger.assets.find((asset) => asset.name === 'latest.json');
            const loopbackBaseUrl = `http://127.0.0.1:43991/${'b'.repeat(48)}`;
            const localManifestPath = path.join(fixture.root, 'local-receipt-manifest.json');
            const platformKeys = ['darwin-aarch64', 'darwin-aarch64-app'];
            createLoopbackUpdaterManifest({
                baseUrl: loopbackBaseUrl,
                canonicalManifestPath: path.join(fixture.assetDir, 'latest.json'),
                output: localManifestPath,
                payloadName: payload.name,
                platformKeys,
            });
            fs.writeFileSync(receiptPath, JSON.stringify({
                kind: 'rav-updater-acceptance-receipt',
                status: 'passed',
                generatedAt: '2030-01-02T03:04:05.000Z',
                repository: ledger.repository,
                releaseId: ledger.releaseId,
                tag: ledger.tag,
                candidateCommit: ledger.candidateCommit,
                installedVersion: ledger.version,
                ledgerSha256: sha256File(fixture.ledgerPath),
                canonicalManifestSha256: manifest.sha256,
                localManifestSha256: sha256File(localManifestPath),
                loopbackBaseUrl,
                payload,
                platformKeys,
                manifestRequests: 1,
                payloadRequests: 1,
                runtimeSignatureVerification: true,
                relaunchObserved: true,
                isolatedTempBundle: true,
                protectedApplicationsBundleUnchanged: true,
            }));
            expect(verifyUpdaterAcceptanceReceipt({
                ledgerPath: fixture.ledgerPath,
                receiptPath,
            })).toMatchObject({ status: 'passed' });
            const tampered = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
            tampered.localManifestSha256 = '0'.repeat(64);
            fs.writeFileSync(receiptPath, JSON.stringify(tampered));
            expect(() => verifyUpdaterAcceptanceReceipt({
                ledgerPath: fixture.ledgerPath,
                receiptPath,
            })).toThrow(/local manifest digest/);
        } finally {
            fixture.cleanup();
        }
    });
});
