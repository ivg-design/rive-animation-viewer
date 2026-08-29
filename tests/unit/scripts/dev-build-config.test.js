import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

describe('isolated 2.5.3 DEV build', () => {
    it('uses a distinct app identity, frontend output, server, and MCP port', () => {
        const pkg = JSON.parse(read('package.json'));
        const production = JSON.parse(read('src-tauri/tauri.conf.json'));
        const dev = JSON.parse(read('src-tauri/tauri.flicker-test.conf.json'));
        const nativeConstants = read('src-tauri/src/app/constants.rs');
        const devBuilder = read('scripts/build-dev-dist.mjs');
        const devServer = read('scripts/serve-dev.mjs');

        expect(pkg.version).toBe('2.5.3');
        expect(production.version).toBe(pkg.version);
        expect(dev.version).toBe(pkg.version);
        expect(dev.productName).toBe('RAV 2.5.3 DEV');
        expect(dev.identifier).toBe('app.rive.animation.viewer.flicker-test');
        expect(dev.identifier).not.toBe(production.identifier);
        expect(dev.build.devUrl).toBe('http://localhost:1421');
        expect(dev.build.frontendDist).toBe('../dist-dev');
        expect(dev.build.beforeBuildCommand).toContain('build-dev-dist.mjs');
        expect(dev.bundle.createUpdaterArtifacts).toBe(false);
        expect(dev.bundle.fileAssociations).toBeNull();
        expect(dev.bundle.macOS.infoPlist).toBe('Info.dev.plist');
        expect(read('.gitignore')).toContain('dist-dev/');
        expect(read('scripts/build-dist.mjs')).toContain("'overlay.html'");
        expect(devBuilder).toContain("APP_BUILD_CHANNEL: 'dev'");
        expect(devBuilder).toContain("APP_DIST_DIR: 'dist-dev'");
        expect(pkg.scripts.start).toContain('serve-dev.mjs --port 1420 --open');
        expect(pkg.scripts.serve).toContain('serve-dev.mjs --port 1420');
        expect(pkg.scripts['serve:dev']).toContain('serve-dev.mjs --port 1421');
        expect(pkg.scripts.dev).toContain('serve-dev.mjs --port 1420');
        expect(devServer).toContain("'--port', String(port)");
        expect(devServer).toContain("VITE_RAV_MCP_PORT: '9278'");
        expect(nativeConstants).toContain('pub const DEFAULT_MCP_PORT: u16 = 9274;');
        expect(nativeConstants).toContain('pub const ISOLATED_DEV_MCP_PORT: u16 = 9278;');
    });

    it('clears production document registration from the DEV app', () => {
        const plist = read('src-tauri/Info.dev.plist');
        expect(plist).toContain('<key>CFBundleDocumentTypes</key>');
        expect(plist).toContain('<key>UTExportedTypeDeclarations</key>');
        expect(plist).toContain('<key>UTImportedTypeDeclarations</key>');
        expect(plist.match(/<array\/>/g)).toHaveLength(3);
    });
});
