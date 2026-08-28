import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('macOS Rive document registration', () => {
    it('references the official Rive UTI and the legacy RAV migration UTI', () => {
        const config = JSON.parse(read('src-tauri/tauri.conf.json'));
        const association = config.bundle.fileAssociations.find((item) => item.ext?.includes('riv'));

        expect(association).toEqual(expect.objectContaining({
            rank: 'Alternate',
            role: 'Viewer',
            mimeType: 'application/vnd.rive.editor',
            contentTypes: [
                'app.rive.editor.rive-file',
                'app.rive.animation.viewer.riv',
            ],
        }));
        expect(association.exportedType).toBeUndefined();
        expect(config.bundle.macOS.infoPlist).toBe('Info.production.plist');
    });

    it('declares official and legacy UTI icon metadata in the merged plist source', () => {
        const plist = read('src-tauri/Info.production.plist');

        expect(plist).toContain('<key>UTImportedTypeDeclarations</key>');
        expect(plist).toContain('<key>UTExportedTypeDeclarations</key>');
        expect(plist).toContain('<string>app.rive.editor.rive-file</string>');
        expect(plist).toContain('<string>app.rive.animation.viewer.riv</string>');
        expect(plist).toContain('<string>application/vnd.rive.editor</string>');
        expect(plist).toContain('<string>RiveFileIcon.icns</string>');
        expect(plist).toContain('<key>CFBundleTypeIconSystemGenerated</key>');
        expect(plist).toContain('<false/>');
        expect(read('src-tauri/icons/README.md')).toContain('src-tauri/icons/RiveFileIcon.icns');
    });

    it('wires marker-gated startup refresh without automatic handler takeover', () => {
        const main = read('src-tauri/src/main.rs');
        const launchServices = read('src-tauri/src/app/launch_services.rs');
        const registration = read('src-tauri/src/app/launch_services/registration.rs');

        expect(main).toContain('app::launch_services::refresh_for_installed_version(');
        expect(launchServices).toContain('is_official_app_identifier(identifier)');
        expect(launchServices).toContain('registration::register_bundle(&canonical_bundle)?;');
        expect(registration).not.toContain('set_default_handler');
    });
});
