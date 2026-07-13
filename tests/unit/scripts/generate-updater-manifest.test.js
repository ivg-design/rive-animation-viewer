import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { generateUpdaterManifest } from '../../../scripts/generate-updater-manifest.mjs';

describe('generate-updater-manifest', () => {
    it('replaces draft release asset URLs with permanent version-tag URLs', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rav-updater-manifest-'));
        const signatureDir = path.join(tempDir, 'signatures');
        const releaseFile = path.join(tempDir, 'release.json');
        const output = path.join(tempDir, 'latest.json');
        fs.mkdirSync(signatureDir);

        const appName = 'Rive.Animation.Viewer_aarch64.app.tar.gz';
        const msiName = 'Rive.Animation.Viewer_2.4.0_x64_en-US.msi';
        fs.writeFileSync(path.join(signatureDir, `${appName}.sig`), 'mac-signature\n');
        fs.writeFileSync(path.join(signatureDir, `${msiName}.sig`), 'windows-signature\n');
        fs.writeFileSync(releaseFile, JSON.stringify({
            tagName: 'v2.4.0',
            body: 'Release notes',
            publishedAt: '2026-07-13T19:31:11.415Z',
            assets: [
                {
                    name: appName,
                    url: `https://github.com/ivg-design/rive-animation-viewer/releases/download/untagged-draft/${appName}`,
                },
                { name: `${appName}.sig`, url: 'https://example.invalid/mac.sig' },
                {
                    name: msiName,
                    url: `https://github.com/ivg-design/rive-animation-viewer/releases/download/untagged-draft/${msiName}`,
                },
                { name: `${msiName}.sig`, url: 'https://example.invalid/windows.sig' },
            ],
        }));

        try {
            const manifest = generateUpdaterManifest({ releaseFile, signatureDir, output });
            const serialized = fs.readFileSync(output, 'utf8');

            expect(manifest.version).toBe('2.4.0');
            expect(manifest.platforms['darwin-aarch64'].url)
                .toBe(`https://github.com/ivg-design/rive-animation-viewer/releases/download/v2.4.0/${appName}`);
            expect(manifest.platforms['windows-x86_64'].url)
                .toBe(`https://github.com/ivg-design/rive-animation-viewer/releases/download/v2.4.0/${msiName}`);
            expect(serialized).not.toContain('/untagged-');
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
