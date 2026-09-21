import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

describe('isolated next-version DEV build', () => {
    it('uses a distinct app identity, frontend output, server, and MCP port', () => {
        const pkg = JSON.parse(read('package.json'));
        const production = JSON.parse(read('src-tauri/tauri.conf.json'));
        const dev = JSON.parse(read('src-tauri/tauri.flicker-test.conf.json'));
        const nativeConstants = read('src-tauri/src/app/constants.rs');
        const devBuilder = read('scripts/build-dev-dist.mjs');
        const devServer = read('scripts/serve-dev.mjs');
        const versionBump = read('scripts/bump-version.mjs');
        const versionCheck = read('scripts/check-release-version.mjs');

        expect(pkg.version).toBe('2.5.8');
        expect(production.version).toBe(pkg.version);
        const productionParts = pkg.version.split('.').map(Number);
        const devParts = dev.version.split('.').map(Number);
        expect(devParts.join('.')).toBe('2.5.9');
        expect(devParts.some((part, index) => part !== productionParts[index])).toBe(true);
        expect(dev.productName).toBe('RAV 2.5.9 DEV');
        expect(dev.mainBinaryName).toBe('rav-2.5.9-dev');
        expect(versionBump).toContain("bumpVersion(newVersion, 'patch')");
        expect(versionCheck).toContain('must be newer than production');
        expect(dev.identifier).toBe('app.rive.animation.viewer.flicker-test');
        expect(dev.identifier).not.toBe(production.identifier);
        expect(dev.build.devUrl).toBe('http://localhost:1421');
        expect(dev.build.frontendDist).toBe('../dist-dev');
        expect(dev.build.beforeBuildCommand).toContain('build-dev-dist.mjs');
        expect(dev.bundle.createUpdaterArtifacts).toBe(false);
        expect(dev.bundle.fileAssociations).toEqual([
            expect.objectContaining({
                contentTypes: [
                    'app.rive.editor.rive-file',
                    'app.rive.riv',
                    'com.play.riv',
                    'app.rive.animation.viewer.riv',
                ],
                ext: ['riv'],
                rank: 'Alternate',
                role: 'Viewer',
            }),
        ]);
        expect(dev.bundle.macOS.infoPlist).toBe('Info.dev.plist');
        expect(read('.gitignore')).toContain('dist-dev/');
        expect(read('scripts/build-dist.mjs')).toContain("'overlay.html'");
        expect(devBuilder).toContain("APP_BUILD_CHANNEL: 'dev'");
        expect(devBuilder).toContain("APP_DIST_DIR: 'dist-dev'");
        expect(devBuilder).toContain('APP_VERSION: devVersion');
        expect(pkg.scripts.start).toContain('serve-dev.mjs --port 1420 --open');
        expect(pkg.scripts.serve).toContain('serve-dev.mjs --port 1420');
        expect(pkg.scripts['serve:dev']).toContain('serve-dev.mjs --port 1421');
        expect(pkg.scripts.dev).toContain('serve-dev.mjs --port 1420');
        expect(devServer).toContain("'--port', String(port)");
        expect(devServer).toContain("VITE_RAV_MCP_PORT: '9278'");
        expect(nativeConstants).toContain('pub const DEFAULT_MCP_PORT: u16 = 9274;');
        expect(nativeConstants).toContain('pub const ISOLATED_DEV_MCP_PORT: u16 = 9278;');
    });

    it('registers DEV as an explicit alternate .riv viewer without exporting a UTI', () => {
        const plist = read('src-tauri/Info.dev.plist');
        expect(plist).toContain('<key>CFBundleDocumentTypes</key>');
        expect(plist).toContain('<key>UTExportedTypeDeclarations</key>');
        expect(plist).toContain('<key>UTImportedTypeDeclarations</key>');
        expect(plist).toContain('<string>Rive File (extension fallback)</string>');
        expect(plist).toContain('<string>RiveFileIcon.icns</string>');
        expect(plist).toContain('<string>app.rive.editor.rive-file</string>');
        expect(plist).toContain('<string>app.rive.riv</string>');
        expect(plist).toContain('<string>com.play.riv</string>');
        expect(plist).toContain('<string>app.rive.animation.viewer.riv</string>');
        expect(plist.match(/<string>Alternate<\/string>/g)).toHaveLength(2);
        expect(plist.match(/<key>LSItemContentTypes<\/key>/g)).toHaveLength(1);
        expect(plist.match(/<array\/>/g)).toHaveLength(1);
    });

    it('keeps documentation capture on the isolated DEV build path', () => {
        const pkg = JSON.parse(read('package.json'));
        expect(pkg.scripts['build:docs-capture']).toBe('npm run build:dev -- --features docs-capture');
        expect(pkg.scripts['build:dev']).toContain('--config src-tauri/tauri.flicker-test.conf.json');
        expect(pkg.scripts['build:dev']).not.toContain('--features docs-capture');
        expect(read('src-tauri/Cargo.toml')).toContain('docs-capture = []');
    });
});
