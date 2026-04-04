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

    it('keeps the main app header on the custom titlebar contract', () => {
        const html = readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
        const windowChromeCss = readFileSync(path.join(repoRoot, 'styles', '01-window-chrome.css'), 'utf8');
        const headerMetaCss = readFileSync(path.join(repoRoot, 'styles', '01-header-meta.css'), 'utf8');

        expect(html).toContain('id="window-titlebar"');
        expect(html).toContain('id="header-file-meta"');
        expect(html).toContain('id="window-controls"');
        expect(html).toContain('id="window-close-btn"');
        expect(html).toContain('id="window-titlebar-left" data-tauri-drag-region');
        expect(html).toContain('id="window-titlebar-center" data-tauri-drag-region');
        expect(html).not.toContain('id="transparency-mode-toggle"');
        expect(html).not.toContain('id="click-through-toggle"');
        expect(windowChromeCss).toContain('.titlebar-row');
        expect(windowChromeCss).toContain('grid-template-columns: max-content minmax(0, 1fr) max-content;');
        expect(windowChromeCss).toContain('border-radius: 18px;');
        expect(windowChromeCss).not.toContain('app-region: drag;');
        expect(headerMetaCss).toContain('grid-template-columns: minmax(0, 1fr) auto auto;');
        expect(html.indexOf('id="settings-btn"')).toBeLessThan(html.indexOf('id="demo-bundle-btn"'));
        expect(html.indexOf('id="mcp-setup-btn"')).toBeLessThan(html.indexOf('id="demo-bundle-btn"'));
    });

    it('keeps the Tauri window capability wired for drag, minimize, maximize, and close', () => {
        const tauriConfig = JSON.parse(readFileSync(path.join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'));
        const capability = JSON.parse(readFileSync(path.join(repoRoot, 'src-tauri', 'capabilities', 'default.json'), 'utf8'));
        const mainWindow = tauriConfig.app.windows[0];

        expect(tauriConfig.app.security.capabilities).toContain('main-capability');
        expect(mainWindow.decorations).toBe(false);
        expect(mainWindow.transparent).toBe(false);
        expect(mainWindow).not.toHaveProperty('titleBarStyle');
        expect(mainWindow).not.toHaveProperty('hiddenTitle');
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
    });
});
