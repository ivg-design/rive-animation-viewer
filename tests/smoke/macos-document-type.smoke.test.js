import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());

function read(relativePath) {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('macOS Rive document registration', () => {
    it('references the official Rive UTI without claiming ownership', () => {
        const config = JSON.parse(read('src-tauri/tauri.conf.json'));
        const association = config.bundle.fileAssociations.find((item) => item.ext?.includes('riv'));

        expect(association).toEqual(expect.objectContaining({
            rank: 'Alternate',
            role: 'Viewer',
            mimeType: 'application/vnd.rive.editor',
            contentTypes: ['app.rive.editor.rive-file'],
        }));
        expect(association.exportedType).toBeUndefined();
        expect(config.bundle.macOS.infoPlist).toBe('Info.plist');
    });

    it('declares imported UTI and dedicated icon metadata in the merged plist source', () => {
        const plist = read('src-tauri/Info.plist');

        expect(plist).toContain('<key>UTImportedTypeDeclarations</key>');
        expect(plist).toContain('<string>app.rive.editor.rive-file</string>');
        expect(plist).toContain('<string>application/vnd.rive.editor</string>');
        expect(plist).toContain('<string>RiveFileIcon.icns</string>');
        expect(read('src-tauri/icons/README.md')).toContain('src-tauri/icons/RiveFileIcon.icns');
    });
});
