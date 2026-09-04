import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

describe('native shell configuration smoke', () => {
    it('keeps production resources, window capabilities, and controls wired', () => {
        const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'));
        const tauriWindowsConfig = JSON.parse(read('src-tauri/tauri.windows.conf.json'));
        const cargoToml = read('src-tauri/Cargo.toml');
        const mainRs = read('src-tauri/src/main.rs');
        const mcpBridgeRs = read('src-tauri/src/app/mcp/bridge.rs');
        const mcpCommandsRs = read('src-tauri/src/app/mcp/commands.rs');
        const updaterRs = read('src-tauri/src/app/updater.rs');
        const mcpBridgeClient = read('src/app/platform/mcp/bridge-client.js');
        const windowControls = read('src-tauri/src/app/window/controls.rs');
        const capability = JSON.parse(read('src-tauri/capabilities/default.json'));
        const renderSurfaceCapability = JSON.parse(
            read('src-tauri/capabilities/render-surface.json'),
        );
        const mainWindow = tauriConfig.app.windows[0];
        const windowsMainWindow = tauriWindowsConfig.app.windows[0];

        expect(tauriConfig.app.security.capabilities).toContain('main-capability');
        expect(tauriConfig.app.security.capabilities).toContain('render-surface-capability');
        expect(tauriConfig.app.macOSPrivateApi).toBe(false);
        expect(tauriConfig.bundle.macOS.hardenedRuntime).toBe(true);
        expect(tauriConfig.bundle.macOS.signingIdentity).toBeUndefined();
        expect(tauriConfig.bundle.resources).toEqual({
            'icons/RiveFileIcon.icns': 'RiveFileIcon.icns',
            'encoder-resources/encoders/': 'encoders/',
        });
        expect(tauriConfig.build.beforeBuildCommand).toContain(
            'encoder-distribution/encoders.mjs verify',
        );
        expect(tauriConfig.build.beforeDevCommand).toContain('build:mcp:debug');
        expect(mainWindow.label).toBe('main');
        expect(mainWindow.create).toBe(false);
        expect(mainWindow.decorations).toBe(true);
        expect(mainWindow.backgroundColor).toBe('#0A0A0AFF');
        expect(mainWindow.transparent).toBe(false);
        expect(mainWindow.titleBarStyle).toBe('Overlay');
        expect(mainWindow.trafficLightPosition).toBeUndefined();
        expect(mainWindow.hiddenTitle).toBe(true);
        expect(windowsMainWindow.decorations).toBe(false);
        expect(windowsMainWindow.label).toBe('main');
        expect(windowsMainWindow.create).toBe(false);
        expect(windowsMainWindow.transparent).toBe(false);
        expect(windowsMainWindow.titleBarStyle).toBe('Visible');
        expect(windowsMainWindow.trafficLightPosition).toBeNull();
        expect(windowsMainWindow.hiddenTitle).toBe(false);
        expect(mainRs).not.toContain('set_decorations(false)');
        expect(mainRs).toContain('hide_macos_traffic_lights(&_window)');
        expect(mainRs).toContain('WebviewWindowBuilder::from_config');
        expect(mainRs).toContain('.incognito(true)');
        expect(mainRs).toContain('window.__RAV_UPDATER_ACCEPTANCE__ = true;');
        expect(mcpBridgeClient).toContain('window.__RAV_UPDATER_ACCEPTANCE__ === true');
        expect(mcpBridgeClient).toContain('window.__RAV_TELEMETRY_ACCEPTANCE__ === true');
        expect(mcpBridgeClient).toContain('if (!restrictedMcpMode)');
        expect(mcpCommandsRs).toContain(
            'MCP bridge changes are disabled during updater acceptance',
        );
        expect(mcpBridgeRs).toContain('kill_spawned_mcp_bridge');
        expect(updaterRs).toContain('if !acceptance.is_enabled()');
        expect(mainRs).toContain('apply_windows_corner_preference(&_window)');
        expect(windowControls).toContain('DwmSetWindowAttribute');
        expect(windowControls).toContain('DWMWA_WINDOW_CORNER_PREFERENCE');
        expect(windowControls).toContain('NSWindowButton::CloseButton');
        expect(windowControls).toContain('NSWindowButton::MiniaturizeButton');
        expect(windowControls).toContain('NSWindowButton::ZoomButton');
        expect(windowControls).toContain('button.setHidden(true)');
        expect(cargoToml).toContain("[target.'cfg(target_os = \"windows\")'.dependencies]");
        expect(cargoToml).toContain('windows-sys');
        expect(capability.identifier).toBe('main-capability');
        expect(capability.webviews).toContain('main');
        expect(capability.permissions).toEqual(expect.arrayContaining([
            'core:window:allow-close',
            'core:window:allow-minimize',
            'core:window:allow-start-dragging',
            'core:window:allow-toggle-maximize',
        ]));
        expect(renderSurfaceCapability.identifier).toBe('render-surface-capability');
        expect(renderSurfaceCapability.webviews).toEqual(['render-surface-*']);
        expect(renderSurfaceCapability.permissions).toEqual([
            'core:event:allow-listen',
            'core:event:allow-unlisten',
            'core:event:allow-emit',
            'core:event:allow-emit-to',
        ]);
        expect(renderSurfaceCapability.permissions).not.toContain('core:default');
    });
});
