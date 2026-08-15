import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('macOS Rive document registration', () => {
    it('exports and owns the canonical RAV .riv UTI', () => {
        const config = JSON.parse(read('src-tauri/tauri.conf.json'));
        const association = config.bundle.fileAssociations.find((item) => item.ext?.includes('riv'));

        expect(association).toEqual(expect.objectContaining({
            rank: 'Owner',
            role: 'Viewer',
            mimeType: 'application/vnd.rive.editor',
            contentTypes: ['app.rive.animation.viewer.riv'],
            exportedType: {
                identifier: 'app.rive.animation.viewer.riv',
                conformsTo: ['public.data', 'public.content'],
            },
        }));
        expect(config.bundle.macOS.infoPlist).toBe('Info.plist');
        expect(config.bundle.macOS.files).toBeUndefined();
        expect(config.build.beforeBundleCommand).toBeUndefined();
    });

    it('declares one exported UTI with the authored document icon', () => {
        const plist = read('src-tauri/Info.plist');

        expect(plist).not.toContain('<key>UTImportedTypeDeclarations</key>');
        expect(plist).toContain('<key>UTExportedTypeDeclarations</key>');
        expect(plist.match(/<key>UTExportedTypeDeclarations<\/key>/g)).toHaveLength(1);
        expect(plist).not.toContain('<string>app.rive.editor.rive-file</string>');
        expect(plist.match(/<string>app\.rive\.animation\.viewer\.riv<\/string>/g)).toHaveLength(2);
        expect(plist).toContain('<string>application/vnd.rive.editor</string>');
        expect(plist.match(/<string>RiveFileIcon\.icns<\/string>/g)).toHaveLength(2);
        expect(plist).toContain('<string>Owner</string>');
        expect(plist).toContain('<key>CFBundleTypeIconSystemGenerated</key>');
        expect(plist).toContain('<false/>');
        expect(read('src-tauri/icons/README.md')).toContain('src-tauri/icons/RiveFileIcon.icns');
    });
});
