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
        expect(config.bundle.macOS.infoPlist).toBe('Info.plist');
    });

    it('declares official and legacy UTI icon metadata in the merged plist source', () => {
        const plist = read('src-tauri/Info.plist');

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
});
