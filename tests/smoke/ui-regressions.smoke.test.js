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
        expect(appBaseCss).toContain('#canvas-container::-webkit-scrollbar');
        expect(appBaseCss).toContain('#canvas-container::-webkit-scrollbar-track');
        expect(appBaseCss).toContain('#canvas-container::-webkit-scrollbar-thumb');

        expect(demoBaseCss).toContain('.properties-panel-body::-webkit-scrollbar');
        expect(demoBaseCss).toContain('.event-log-body::-webkit-scrollbar');
    });

    it('keeps the Properties viewport horizontally contained and focus-safe', () => {
        const workspaceCss = readFileSync(path.join(repoRoot, 'styles', '03-workspace.css'), 'utf8');
        const propertiesCss = readFileSync(path.join(repoRoot, 'styles', '07-properties.css'), 'utf8');
        const imageControlCss = readFileSync(path.join(repoRoot, 'styles', '07-properties-images.css'), 'utf8');
        const viewportController = readFileSync(
            path.join(repoRoot, 'src', 'app', 'ui', 'layout', 'properties-panel-viewport.js'),
            'utf8',
        );

        expect(workspaceCss).toMatch(/\.panel\s*\{[^}]*min-width:\s*0;/);
        expect(propertiesCss).toMatch(/\.properties-panel-body\s*\{[^}]*overflow-x:\s*hidden;/);
        expect(propertiesCss).toMatch(/\.properties-panel-body > \*,[\s\S]*?\.vm-control-row,[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/);
        expect(propertiesCss).toMatch(/\.vm-child-nodes\s*\{[^}]*width:\s*calc\(100% - 8px\);/);
        expect(propertiesCss).toMatch(/\.vm-section-header > span[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/);
        expect(propertiesCss).toMatch(/\.artboard-switcher > \.vm-section\[open\] > \.vm-section-body\s*\{[^}]*min-height:\s*196px;/);
        expect(propertiesCss).toMatch(/\.artboard-selection-summary\[hidden\]\s*\{[^}]*display:\s*block;[^}]*min-height:\s*13px;[^}]*visibility:\s*hidden;/);
        expect(propertiesCss).toContain('max-width: 100%;');
        expect(imageControlCss).toMatch(/\.vm-image-control\s*\{[^}]*position:\s*relative;/);
        expect(imageControlCss).toMatch(/\.vm-image-file-input\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0 auto auto 0;[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*overflow:\s*hidden;[^}]*pointer-events:\s*none;/);
        expect(viewportController).toContain("viewport.addEventListener('focusin', scheduleReset);");
        expect(viewportController).toContain("viewport.addEventListener('scroll', resetHorizontalPosition);");
    });

    it('uses overflow-safe flex centering for fixed canvases', () => {
        const workspaceCss = readFileSync(path.join(repoRoot, 'styles', '03-workspace.css'), 'utf8');
        const renderSurfaceCss = readFileSync(
            path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'css', 'overlays.css'),
            'utf8',
        );
        const fixedCanvasRule = workspaceCss.match(/#canvas-container\.canvas-container-fixed-size\s*\{([^}]*)\}/)?.[1] || '';
        const fixedCanvasElementRule = workspaceCss.match(/#rive-canvas\.rive-canvas-fixed-size\s*\{([^}]*)\}/)?.[1] || '';
        const renderSurfaceFixedCanvasRule = renderSurfaceCss.match(
            /body\.render-surface-mode #canvas-container\.canvas-container-fixed-size\s*\{([^}]*)\}/,
        )?.[1] || '';
        const renderSurfaceFixedCanvasElementRule = renderSurfaceCss.match(
            /body\.render-surface-mode #rive-canvas\.rive-canvas-fixed-size\s*\{([^}]*)\}/,
        )?.[1] || '';

        expect(fixedCanvasRule).toContain('overflow: auto;');
        expect(fixedCanvasRule).toContain('align-items: flex-start;');
        expect(fixedCanvasRule).toContain('justify-content: flex-start;');
        expect(fixedCanvasElementRule).toContain('margin: auto;');
        expect(fixedCanvasElementRule).not.toContain('transform:');
        expect(renderSurfaceFixedCanvasRule).toContain('display: flex;');
        expect(renderSurfaceFixedCanvasRule).toContain('overflow: auto;');
        expect(renderSurfaceFixedCanvasRule).toContain('align-items: flex-start;');
        expect(renderSurfaceFixedCanvasRule).toContain('justify-content: flex-start;');
        expect(renderSurfaceFixedCanvasElementRule).toContain('margin: auto;');
        expect(renderSurfaceFixedCanvasElementRule).not.toContain('transform:');
    });

    it('keeps the FPS badge footprint stable while the child renderer connects', () => {
        const headerCss = readFileSync(path.join(repoRoot, 'styles', '01-header-controls.css'), 'utf8');
        const fpsIndicator = readFileSync(
            path.join(repoRoot, 'src', 'app', 'platform', 'render-surface', 'fps-indicator.js'),
            'utf8',
        );
        const fpsChipRule = headerCss.match(/\.fps-chip\s*\{([^}]*)\}/)?.[1] || '';
        expect(fpsChipRule).toContain('flex: 0 0 80px;');
        expect(fpsChipRule).toContain('width: 80px;');
        expect(fpsIndicator).toContain("const label = hasFps ? `${Math.round(Number(fps))} FPS` : '-- FPS'");
    });

    it('fully skins the timeline progress control instead of inheriting native WebView chrome', () => {
        const timelineCss = readFileSync(
            path.join(repoRoot, 'styles', '01-timeline-progress.css'),
            'utf8',
        );
        const progressRule = timelineCss.match(/\.timeline-progress-bar\s*\{([^}]*)\}/)?.[1] || '';

        expect(progressRule).toContain('-webkit-appearance: none;');
        expect(progressRule).toContain('appearance: none;');
        expect(progressRule).toContain('border: 0;');
        expect(progressRule).toContain('background: var(--bg-elevated);');
        expect(timelineCss).toContain('.timeline-progress-bar::-webkit-progress-bar');
        expect(timelineCss).toContain('.timeline-progress-bar::-webkit-progress-value');
        expect(timelineCss).toContain('.timeline-progress-bar::-moz-progress-bar');
    });

    it('keeps the main app header on the custom titlebar contract', () => {
        const html = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
        const baseCss = readFileSync(path.join(repoRoot, 'styles', '00-base.css'), 'utf8');
        const windowChromeCss = readFileSync(path.join(repoRoot, 'styles', '01-window-chrome.css'), 'utf8');
        const headerMetaCss = readFileSync(path.join(repoRoot, 'styles', '01-header-meta.css'), 'utf8');
        const desktopShellRule = windowChromeCss.match(/body\.is-tauri-window \.app-shell\s*\{([^}]*)\}/)?.[1] || '';

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
        expect(baseCss).toMatch(/html\.is-tauri-window,\s*body\.is-tauri-window\s*\{[^}]*background:\s*var\(--bg-void\)/);
        expect(windowChromeCss).toMatch(/body\.is-tauri-window\s*\{[^}]*background:\s*#101116/);
        expect(desktopShellRule).not.toContain('border-radius:');
        expect(desktopShellRule).not.toContain('overflow: hidden;');
        expect(desktopShellRule).not.toContain('box-shadow:');
        expect(windowChromeCss).not.toContain('app-region: drag;');
        expect(headerMetaCss).toContain('grid-template-columns: minmax(0, 1fr) auto auto;');
        expect(html.indexOf('id="settings-btn"')).toBeLessThan(html.indexOf('id="demo-bundle-btn"'));
        expect(html.indexOf('id="mcp-setup-btn"')).toBeLessThan(html.indexOf('id="demo-bundle-btn"'));
    });

    it('keeps anonymous usage concise and immediately before the dynamic About row', () => {
        const html = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
        const aboutController = readFileSync(path.join(repoRoot, 'src', 'app', 'ui', 'about', 'about-dialog.js'), 'utf8');

        expect(html).not.toContain('install-counter-privacy-note');
        expect(html).not.toContain('install-counter-privacy-btn');
        expect(html.indexOf('id="install-counter-enabled-btn"')).toBeGreaterThan(html.indexOf('id="canvas-size-aspect-value"'));
        expect(aboutController).toContain('popover.append(row);');
    });

    it('keeps the About build and links cards equal-height with two link rows', () => {
        const aboutCss = readFileSync(path.join(repoRoot, 'styles', '10-about-dialog.css'), 'utf8');
        const bodyRule = aboutCss.match(/\.about-dialog-body\s*\{([^}]*)\}/)?.[1] || '';
        const topCardRule = aboutCss.match(/\.about-dialog-card-build,\s*\.about-dialog-card-links\s*\{([^}]*)\}/)?.[1] || '';
        const linksRule = aboutCss.match(/\.about-dialog-links\s*\{([^}]*)\}/)?.[1] || '';

        expect(bodyRule).toContain('align-items: stretch;');
        expect(topCardRule).toContain('align-self: stretch;');
        expect(topCardRule).toContain('height: 100%;');
        expect(linksRule).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
        expect(aboutCss).not.toMatch(
            /@media[^\{]*max-height[^\{]*\{[\s\S]*?\.about-dialog-body\s*\{[\s\S]*?(?:grid-template-columns|overflow-y)/,
        );
    });

    it('keeps the Tauri window capability wired for drag, minimize, maximize, and close', () => {
        const tauriConfig = JSON.parse(readFileSync(path.join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'));
        const tauriWindowsConfig = JSON.parse(readFileSync(path.join(repoRoot, 'src-tauri', 'tauri.windows.conf.json'), 'utf8'));
        const cargoToml = readFileSync(path.join(repoRoot, 'src-tauri', 'Cargo.toml'), 'utf8');
        const mainRs = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'main.rs'), 'utf8');
        const mcpBridgeRs = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'app', 'mcp', 'bridge.rs'), 'utf8');
        const mcpCommandsRs = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'app', 'mcp', 'commands.rs'), 'utf8');
        const updaterRs = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'app', 'updater.rs'), 'utf8');
        const mcpBridgeClient = readFileSync(path.join(repoRoot, 'src', 'app', 'platform', 'mcp', 'bridge-client.js'), 'utf8');
        const windowControls = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'app', 'window', 'controls.rs'), 'utf8');
        const capability = JSON.parse(readFileSync(path.join(repoRoot, 'src-tauri', 'capabilities', 'default.json'), 'utf8'));
        const renderSurfaceCapability = JSON.parse(readFileSync(
            path.join(repoRoot, 'src-tauri', 'capabilities', 'render-surface.json'),
            'utf8',
        ));
        const mainWindow = tauriConfig.app.windows[0];
        const windowsMainWindow = tauriWindowsConfig.app.windows[0];

        expect(tauriConfig.app.security.capabilities).toContain('main-capability');
        expect(tauriConfig.app.security.capabilities).toContain('render-surface-capability');
        expect(tauriConfig.app.macOSPrivateApi).toBe(false);
        expect(tauriConfig.bundle.macOS.hardenedRuntime).toBe(true);
        expect(tauriConfig.bundle.macOS.signingIdentity).toBeUndefined();
        expect(tauriConfig.bundle.resources).toEqual({
            'icons/RiveFileIcon.icns': 'RiveFileIcon.icns',
        });
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
        expect(mcpCommandsRs).toContain('MCP bridge changes are disabled during updater acceptance');
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

    it('does not retain whole-window transparency or click-through implementation symbols', () => {
        const appSourceRoots = [
            path.join(repoRoot, 'src', 'app'),
            path.join(repoRoot, 'src-tauri', 'src'),
            path.join(repoRoot, 'styles'),
        ];
        const staleSymbols = [
            'createTransparencyController',
            'set_window_transparency_mode',
            'set_window_click_through',
            'get_window_cursor_position',
            'transparency-mode-toggle',
            'click-through-toggle',
            'transparency-mode',
        ];
        const source = appSourceRoots
            .flatMap((root) => walkFiles(root))
            .filter((filePath) => /\.(?:js|rs|css)$/.test(filePath))
            .map((filePath) => readFileSync(filePath, 'utf8'))
            .join('\n');

        for (const symbol of staleSymbols) {
            expect(source).not.toContain(symbol);
        }
        expect(readdirSync(path.join(repoRoot, 'src', 'app', 'platform'))).toContain('canvas-background-controller.js');
        expect(readdirSync(path.join(repoRoot, 'src', 'app', 'platform'))).not.toContain('transparency-controller.js');
    });

    it('resolves the bundled MCP sidecar beside the running executable', () => {
        const mcpBridge = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'app', 'mcp', 'bridge.rs'), 'utf8');

        expect(mcpBridge).toContain('std::env::current_exe()');
        expect(mcpBridge).toContain('resolve_mcp_server_path_from_executable');
        expect(mcpBridge).not.toContain('.executable_dir()');
        expect(mcpBridge).not.toContain('resource_dir()');
    });

    it('keeps the exported demo on the current fullscreen and event-log chrome contract', () => {
        const markup = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'markup.html'), 'utf8');
        const preamble = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'js', 'core', 'preamble.js'), 'utf8');
        const eventLog = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'js', 'core', 'event-log.js'), 'utf8');
        const vmAccessors = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'js', 'vm', 'accessors.js'), 'utf8');
        const vmHierarchy = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'js', 'vm', 'hierarchy.js'), 'utf8');
        const vmSync = readFileSync(path.join(repoRoot, 'src-tauri', 'src', 'demo-template', 'js', 'vm', 'sync.js'), 'utf8');
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
        expect(preamble).toContain('const CONTROL_SELECTION_KEYS = Array.isArray(CONFIG.controlSelectionKeys)');
        expect(preamble).toContain('function normalizeControlSelectionKey(key)');
        expect(preamble).toContain('let pendingControlSnapshot = new Map();');
        expect(eventLog).toContain('function setEventLogCollapsed(collapsed)');
        expect(eventLog).toContain('document.documentElement.requestFullscreen');
        expect(vmAccessors).toContain('typeof input.fire === \'function\' && !(\'value\' in input)');
        expect(riveLoader).toContain('Prefer the current runtime tree so converter-driven lists cannot go stale.');
        expect(riveLoader).toContain('? buildVmHierarchy(rootVm)');
        expect(vmHierarchy).toContain('function buildVmListTopologySignature(rootVm)');
        expect(vmHierarchy).toContain('ALLOWED_CONTROL_KEYS.has(selectionKey)');
        expect(vmHierarchy).toContain('function formatVmListItemLabel(listName, index, itemInstance)');
        expect(vmHierarchy).toContain('function filterHierarchyNode(node)');
        expect(riveLoader).toContain('filterHierarchyNode(liveVmHierarchy)');
        expect(vmSync).toContain('retryPendingControlSnapshot();');
        expect(vmSync).toContain('renderVmControls();');
        expect(vmSync).toContain('if (!syncVmControlTopology()) syncVmControlBindings(false);');
        expect(riveLoader).toContain('fit: resolveRiveLayoutFit(rive, currentLayoutFit)');
        expect(riveLoader).toContain('alignment: resolveRiveLayoutAlignment(rive, currentLayoutAlignment)');
        expect(bootstrap).toContain('scheduleCanvasViewportAlignment');
        expect(bootstrap).toContain('container.scrollLeft = offsets.left;');
        expect(bootstrap).toContain('container.scrollTop = offsets.top;');
        expect(bootstrap).toContain('currentControlSnapshot = JSON.parse(JSON.stringify(resetSnapshot));');
        expect(bootstrap).toContain('riveInstance.reset(resetParams);');
        expect(riveLoader).toContain('applyControlSnapshot(currentControlSnapshot);');
        expect(bootstrap).not.toContain('setupTransparencyControls');
        expect(preamble).not.toContain('DEMO_TRANSPARENCY_TOGGLE_ENABLED');
    });
});
