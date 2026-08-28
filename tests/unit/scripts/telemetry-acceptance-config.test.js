import fs from 'node:fs';

describe('telemetry acceptance config', () => {
    const config = JSON.parse(fs.readFileSync(
        'src-tauri/tauri.telemetry-acceptance.conf.json',
        'utf8',
    ));
    const flickerConfig = JSON.parse(fs.readFileSync(
        'src-tauri/tauri.flicker-test.conf.json',
        'utf8',
    ));

    it('uses a dedicated identity and disables updater artifacts', () => {
        expect(config.identifier).toBe('app.rive.animation.viewer.telemetry-acceptance');
        expect(config.identifier).not.toBe(flickerConfig.identifier);
        expect(config.productName).toBe('RAV Telemetry Acceptance');
        expect(config.mainBinaryName).toBe('rav-telemetry-acceptance');
        expect(config.bundle.createUpdaterArtifacts).toBe(false);
        expect(config.bundle.targets).toEqual(['app']);
        expect(config.bundle.fileAssociations).toBeNull();
        expect(config.bundle.macOS.infoPlist).toBe('Info.telemetry-acceptance.plist');
        expect(fs.existsSync('src-tauri/Info.plist')).toBe(false);
        expect(fs.existsSync('src-tauri/Info.production.plist')).toBe(true);
        const infoPlist = fs.readFileSync(
            `src-tauri/${config.bundle.macOS.infoPlist}`,
            'utf8',
        );
        expect(infoPlist).not.toContain('CFBundleDocumentTypes');
        expect(infoPlist).not.toContain('UTExportedTypeDeclarations');
        expect(infoPlist).not.toContain('UTImportedTypeDeclarations');
        expect(config.build.beforeBuildCommand).toBeNull();
    });
});
