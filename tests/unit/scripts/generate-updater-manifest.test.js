import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
    generateUpdaterManifest,
    REQUIRED_UPDATER_PLATFORMS,
} from '../../../scripts/generate-updater-manifest.mjs';

const FIXTURE_VERSION = '9.8.7';
const FIXTURE_TAG = `v${FIXTURE_VERSION}`;

function fixtureAsset(name) {
    return {
        name,
        url: `https://github.com/ivg-design/rive-animation-viewer/releases/download/untagged-draft/${name}`,
    };
}

function createFixture({ omit = [], publishedAt = '2030-01-02T03:04:05.000Z' } = {}) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rav-updater-manifest-'));
    const signatureDir = path.join(tempDir, 'signatures');
    const releaseFile = path.join(tempDir, 'release.json');
    const output = path.join(tempDir, 'latest.json');
    fs.mkdirSync(signatureDir);

    const artifacts = [
        'Rive.Animation.Viewer_aarch64.app.tar.gz',
        'Rive.Animation.Viewer_x64.app.tar.gz',
        `Rive.Animation.Viewer_${FIXTURE_VERSION}_x64_en-US.msi`,
        `Rive.Animation.Viewer_${FIXTURE_VERSION}_x64-setup.exe`,
    ].filter((name) => !omit.includes(name));

    const assets = [];
    for (const name of artifacts) {
        fs.writeFileSync(path.join(signatureDir, `${name}.sig`), `${name}-signature\n`);
        assets.push(fixtureAsset(name));
        assets.push({
            name: `${name}.sig`,
            url: `https://example.invalid/${encodeURIComponent(name)}.sig`,
        });
    }

    fs.writeFileSync(releaseFile, JSON.stringify({
        tagName: FIXTURE_TAG,
        body: 'Release notes',
        createdAt: '2029-12-01T00:00:00.000Z',
        publishedAt,
        assets,
    }));

    return {
        cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
        output,
        releaseFile,
        signatureDir,
    };
}

describe('generate-updater-manifest', () => {
    it('creates a complete manifest with permanent version-tag URLs', () => {
        const fixture = createFixture();

        try {
            const manifest = generateUpdaterManifest(fixture);
            const serialized = fs.readFileSync(fixture.output, 'utf8');

            expect(manifest.version).toBe(FIXTURE_VERSION);
            expect(Object.keys(manifest.platforms)).toEqual(
                [...REQUIRED_UPDATER_PLATFORMS].sort(),
            );
            expect(manifest.platforms['darwin-aarch64'].url)
                .toContain(`/releases/download/${FIXTURE_TAG}/Rive.Animation.Viewer_aarch64.app.tar.gz`);
            expect(manifest.platforms['darwin-x86_64'].url)
                .toContain(`/releases/download/${FIXTURE_TAG}/Rive.Animation.Viewer_x64.app.tar.gz`);
            expect(manifest.platforms['windows-x86_64'].url)
                .toContain(`Rive.Animation.Viewer_${FIXTURE_VERSION}_x64_en-US.msi`);
            expect(manifest.platforms['windows-x86_64-nsis'].url)
                .toContain(`Rive.Animation.Viewer_${FIXTURE_VERSION}_x64-setup.exe`);
            expect(serialized).not.toContain('/untagged-');
        } finally {
            fixture.cleanup();
        }
    });

    it('uses the immutable draft creation date before publication', () => {
        const fixture = createFixture({ publishedAt: null });
        try {
            const manifest = generateUpdaterManifest(fixture);
            expect(manifest.pub_date).toBe('2029-12-01T00:00:00.000Z');
        } finally {
            fixture.cleanup();
        }
    });

    it('refuses to publish an incomplete cross-platform updater feed', () => {
        const fixture = createFixture({
            omit: ['Rive.Animation.Viewer_x64.app.tar.gz'],
        });

        try {
            expect(() => generateUpdaterManifest(fixture))
                .toThrow(/darwin-x86_64, darwin-x86_64-app/);
        } finally {
            fixture.cleanup();
        }
    });

    it('treats an empty signature as a missing updater platform', () => {
        const fixture = createFixture();
        const archiveName = 'Rive.Animation.Viewer_aarch64.app.tar.gz';
        fs.writeFileSync(
            path.join(fixture.signatureDir, `${archiveName}.sig`),
            ' \n',
        );

        try {
            expect(() => generateUpdaterManifest(fixture))
                .toThrow(/darwin-aarch64, darwin-aarch64-app/);
        } finally {
            fixture.cleanup();
        }
    });

    it('refuses ambiguous duplicate payloads for one platform', () => {
        const fixture = createFixture();
        const duplicateName = 'Rive.Animation.Viewer_legacy_x64.app.tar.gz';
        const release = JSON.parse(fs.readFileSync(fixture.releaseFile, 'utf8'));
        release.assets.push(
            fixtureAsset(duplicateName),
            fixtureAsset(`${duplicateName}.sig`),
        );
        fs.writeFileSync(fixture.releaseFile, JSON.stringify(release));
        fs.writeFileSync(
            path.join(fixture.signatureDir, `${duplicateName}.sig`),
            'duplicate-signature\n',
        );

        try {
            expect(() => generateUpdaterManifest(fixture))
                .toThrow(/multiple payloads for darwin-x86_64/);
        } finally {
            fixture.cleanup();
        }
    });
});
