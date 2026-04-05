import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function walkFiles(rootDirectory, filePaths = []) {
    for (const entry of readdirSync(rootDirectory, { withFileTypes: true })) {
        const nextPath = path.join(rootDirectory, entry.name);
        if (entry.isDirectory()) {
            walkFiles(nextPath, filePaths);
            continue;
        }
        if (entry.isFile()) {
            filePaths.push(nextPath);
        }
    }
    return filePaths;
}

function normalizeRepoPath(absolutePath) {
    return path.relative(repoRoot, absolutePath).replaceAll(path.sep, '/');
}

describe('ui regression smoke', () => {
    it('keeps scrollbar styling centralized in shared base styles plus the Eruda-specific console skin', () => {
        const cssRoots = [
            path.join(repoRoot, 'styles'),
            path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'css'),
        ];
        const allowedScrollbarOwners = new Set([
            'styles/00-base.css',
            'styles/09-script-console.css',
            'src-tauri/src/demo-template/css/base.css',
        ]);

        const offenders = [];
        for (const root of cssRoots) {
            for (const filePath of walkFiles(root).filter((candidate) => candidate.endsWith('.css'))) {
                const relativePath = normalizeRepoPath(filePath);
                const source = readFileSync(filePath, 'utf8');
                const definesScrollbarSkin = /::-webkit-scrollbar|scrollbar-color\s*:|scrollbar-width\s*:\s*(?!auto)/.test(source);
                if (definesScrollbarSkin && !allowedScrollbarOwners.has(relativePath)) {
                    offenders.push(relativePath);
                }
            }
        }

        expect(offenders).toEqual([]);
    });

    it('does not mix standardized scrollbar properties with WebKit scrollbar skinning on app/demo surfaces', () => {
        const scrollbarOwners = [
            path.join(repoRoot, 'styles', '00-base.css'),
            path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'css', 'base.css'),
        ];

        for (const owner of scrollbarOwners) {
            const source = readFileSync(owner, 'utf8');
            expect(source).toMatch(/::-webkit-scrollbar/);
            expect(source).not.toMatch(/scrollbar-width\s*:\s*(?!auto)/);
            expect(source).not.toMatch(/scrollbar-color\s*:/);
        }
    });

    it('keeps the shared scrollbar skin covering the known scrollable surfaces', () => {
        const appBaseCss = readFileSync(path.join(repoRoot, 'styles', '00-base.css'), 'utf8');
        const demoBaseCss = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'css', 'base.css'), 'utf8');

        expect(appBaseCss).toContain('.properties-panel-body::-webkit-scrollbar');
        expect(appBaseCss).toContain('.instantiation-controls-tree::-webkit-scrollbar');
        expect(appBaseCss).toContain('.instantiation-preview-output::-webkit-scrollbar');
        expect(appBaseCss).toContain('.mcp-setup-body::-webkit-scrollbar');
        expect(appBaseCss).toContain('.about-dialog-dependencies::-webkit-scrollbar');
        expect(appBaseCss).toContain('.event-log-body::-webkit-scrollbar');

        expect(demoBaseCss).toContain('.properties-panel-body::-webkit-scrollbar');
        expect(demoBaseCss).toContain('.event-log-body::-webkit-scrollbar');
    });

    it('keeps the main app header on the custom titlebar contract', () => {
        const html = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
        const windowChromeCss = readFileSync(path.join(repoRoot, 'styles', '01-window-chrome.css'), 'utf8');
        const headerMetaCss = readFileSync(path.join(repoRoot, 'styles', '01-header-meta.css'), 'utf8');

        expect(html).toContain('id="window-titlebar"');
        expect(html).toContain('id="header-file-meta"');
        expect(html).toContain('id="window-controls"');
        expect(html).toContain('id="window-close-btn"');
        expect(html).toContain('id="window-titlebar" data-tauri-drag-region');
        expect(html).toContain('id="window-titlebar-left" data-tauri-drag-region');
        expect(html).toContain('id="window-titlebar-center" data-tauri-drag-region');
        expect(html).toContain('id="window-controls" class="window-controls" hidden data-tauri-drag-region="false"');
        expect(html).not.toContain('id="transparency-mode-toggle"');
        expect(html).not.toContain('id="click-through-toggle"');
        expect(windowChromeCss).toContain('.titlebar-row');
        expect(windowChromeCss).toContain('grid-template-columns: max-content minmax(0, 1fr) max-content;');
        expect(windowChromeCss).toContain('body.is-tauri-window .app-shell');
        expect(windowChromeCss).toContain('border-radius: 18px;');
        expect(windowChromeCss).not.toContain('app-region: drag;');
        expect(headerMetaCss).toContain('grid-template-columns: minmax(0, 1fr) auto auto;');
        expect(html.indexOf('id="settings-btn"')).toBeLessThan(html.indexOf('id="demo-bundle-btn"'));
        expect(html.indexOf('id="mcp-setup-btn"')).toBeLessThan(html.indexOf('id="demo-bundle-btn"'));
    });

    it('keeps the Tauri window capability wired for drag, minimize, maximize, and close', () => {
        const tauriConfig = JSON.parse(readFileSync(path.join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'));
        const tauriWindowsConfig = JSON.parse(readFileSync(path.join(repoRoot, 'src-tauri', 'tauri.windows.conf.json'), 'utf8'));
        const cargoToml = readFileSync(path.join(repoRoot, 'src-tauri', 'Cargo.toml'), 'utf8');
        const mainRs = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'main.rs'), 'utf8');
        const windowControls = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'app', 'window', 'controls.rs'), 'utf8');
        const capability = JSON.parse(readFileSync(path.join(repoRoot, 'src-tauri', 'capabilities', 'default.json'), 'utf8'));
        const mainWindow = tauriConfig.app.windows[0];
        const windowsMainWindow = tauriWindowsConfig.app.windows[0];

        expect(tauriConfig.app.security.capabilities).toContain('main-capability');
        expect(tauriConfig.app.macOSPrivateApi).toBe(true);
        expect(mainWindow.decorations).toBe(true);
        expect(mainWindow.transparent).toBe(true);
        expect(mainWindow.titleBarStyle).toBe('Overlay');
        expect(mainWindow.trafficLightPosition).toEqual({ x: -120, y: -120 });
        expect(mainWindow.hiddenTitle).toBe(true);
        expect(windowsMainWindow.decorations).toBe(false);
        expect(windowsMainWindow.transparent).toBe(false);
        expect(windowsMainWindow.titleBarStyle).toBe('Visible');
        expect(windowsMainWindow.trafficLightPosition).toBeNull();
        expect(windowsMainWindow.hiddenTitle).toBe(false);
        expect(mainRs).not.toContain('set_decorations(false)');
        expect(mainRs).toContain('apply_windows_corner_preference(&_window)');
        expect(windowControls).toContain('DwmSetWindowAttribute');
        expect(windowControls).toContain('DWMWA_WINDOW_CORNER_PREFERENCE');
        expect(cargoToml).toContain("[target.'cfg(target_os = \"windows\")'.dependencies]");
        expect(cargoToml).toContain('windows-sys');
        expect(capability.identifier).toBe('main-capability');
        expect(capability.windows).toContain('main');
        expect(capability.permissions).toEqual(expect.arrayContaining([
            'core:window:allow-close',
            'core:window:allow-minimize',
            'core:window:allow-start-dragging',
            'core:window:allow-toggle-maximize',
        ]));
    });

    it('keeps the exported demo on the current fullscreen and event-log chrome contract', () => {
        const markup = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'markup.html'), 'utf8');
        const preamble = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'js', 'core', 'preamble.js'), 'utf8');
        const eventLog = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'js', 'core', 'event-log.js'), 'utf8');
        const vmAccessors = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'js', 'vm', 'accessors.js'), 'utf8');
        const riveLoader = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'js', 'core', 'rive-loader.js'), 'utf8');
        const bootstrap = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'js', 'core', 'bootstrap.js'), 'utf8');

        expect(markup).toContain('id="fullscreen-toggle-btn"');
        expect(markup).toContain('id="event-log-toggle-btn"');
        expect(markup).toContain('id="copy-instantiation-btn"');
        expect(markup).not.toContain('id="transparency-mode-toggle"');
        expect(markup).not.toContain('id="show-event-log-btn"');
        expect(markup).not.toContain('fullscreen-exit-hint');
        expect(markup).not.toContain('event-log-chevron');

        expect(preamble).toContain('const ALLOWED_CONTROL_KEYS = new Set');
        expect(preamble).toContain('function filterHierarchyNode(node)');
        expect(eventLog).toContain('function setEventLogCollapsed(collapsed)');
        expect(eventLog).toContain('document.documentElement.requestFullscreen');
        expect(vmAccessors).toContain('typeof input.fire === \'function\' && !(\'value\' in input)');
        expect(riveLoader).toContain('vmHierarchy = filterHierarchyNode(JSON.parse(JSON.stringify(VM_HIERARCHY)));');
        expect(riveLoader).toContain('fit: resolveRiveLayoutFit(rive, currentLayoutFit)');
        expect(riveLoader).toContain('alignment: resolveRiveLayoutAlignment(rive, currentLayoutAlignment)');
        expect(bootstrap).toContain('scheduleCanvasViewportAlignment');
        expect(bootstrap).toContain('container.scrollLeft = offsets.left;');
        expect(bootstrap).toContain('container.scrollTop = offsets.top;');
    });
});
