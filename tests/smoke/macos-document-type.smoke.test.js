import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('macOS Rive document registration', () => {
    it('seeds known Rive UTIs while remaining an alternate viewer', () => {
        const config = JSON.parse(read('src-tauri/tauri.conf.json'));
        const association = config.bundle.fileAssociations.find((item) => item.ext?.includes('riv'));

        expect(association).toEqual(expect.objectContaining({
            rank: 'Alternate',
            role: 'Viewer',
            mimeType: 'application/vnd.rive.editor',
            contentTypes: [
                'app.rive.editor.rive-file',
                'app.rive.riv',
                'com.play.riv',
                'app.rive.animation.viewer.riv',
            ],
        }));
        expect(association.exportedType).toBeUndefined();
        expect(config.bundle.macOS.infoPlist).toBe('Info.production.plist');
    });

    it('declares known UTI and extension-fallback icon metadata in the merged plist source', () => {
        const plist = read('src-tauri/Info.production.plist');

        expect(plist).toContain('<key>UTImportedTypeDeclarations</key>');
        expect(plist).toContain('<key>UTExportedTypeDeclarations</key>');
        expect(plist).toContain('<string>app.rive.editor.rive-file</string>');
        expect(plist).toContain('<string>app.rive.riv</string>');
        expect(plist).toContain('<string>com.play.riv</string>');
        expect(plist).toContain('<string>app.rive.animation.viewer.riv</string>');
        expect(plist).toContain('<string>Rive File (extension fallback)</string>');
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

    it('discovers every registered .riv UTI instead of relying on a fixed alias list', () => {
        const handlers = read('src-tauri/src/app/launch_services/handlers.rs');
        const commands = read('src-tauri/src/app/launch_services/commands.rs');
        const tests = read('src-tauri/src/app/launch_services/tests.rs');

        expect(handlers).toContain('typesWithTag_tagClass_conformingToType');
        expect(handlers).toContain('UTTagClassFilenameExtension');
        expect(commands).toContain('claim_target_content_type');
        expect(commands).toContain('one macOS request for the effective .riv');
        expect(tests).toContain('dynamic_riv_handler_collection_has_no_fixed_identifier_limit');
        expect(tests).toContain('dynamic_aliases_are_diagnostics_instead_of_click_through_tasks');
        expect(tests).toContain('(0..30)');
    });
});
