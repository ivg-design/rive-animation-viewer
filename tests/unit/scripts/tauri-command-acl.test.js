import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

function manifestCommands() {
    const source = read('src-tauri/build.rs');
    const body = source.match(/const COMMANDS:[\s\S]*?= &\[([\s\S]*?)\];/)?.[1] || '';
    return Array.from(body.matchAll(/"([a-z0-9_]+)"/g), (match) => match[1]);
}

function registeredCommands() {
    const source = read('src-tauri/src/main.rs');
    const body = source.match(/generate_handler!\[([\s\S]*?)\]\)/)?.[1] || '';
    return body.split(',')
        .map((entry) => entry.trim().split('::').at(-1))
        .filter(Boolean);
}

describe('Tauri custom-command ACL', () => {
    it('keeps the build manifest, handler, and least-privilege grants synchronized', () => {
        const commands = manifestCommands();
        expect(commands.sort()).toEqual(registeredCommands().sort());

        const main = JSON.parse(read('src-tauri/capabilities/default.json'));
        expect(main.webviews).toEqual(['main']);
        expect(main.windows).toBeUndefined();
        const overlayChildCommands = ['submit_ui_overlay_action', 'ui_overlay_ready'];
        commands.filter((command) => !overlayChildCommands.includes(command)).forEach((command) => {
            expect(main.permissions).toContain(`allow-${command.replaceAll('_', '-')}`);
        });

        const renderSurface = JSON.parse(read('src-tauri/capabilities/render-surface.json'));
        expect(renderSurface.permissions.some((permission) => permission.startsWith('allow-'))).toBe(false);

        const overlay = JSON.parse(read('src-tauri/capabilities/ui-overlay.json'));
        expect(overlay.permissions).toContain('allow-ui-overlay-ready');
        expect(overlay.permissions).toContain('allow-submit-ui-overlay-action');
        expect(overlay.permissions).not.toContain('allow-complete-ui-overlay-action');
        expect(overlay.permissions).not.toContain('core:event:allow-emit');
        expect(overlay.permissions).not.toContain('core:event:allow-emit-to');
        overlay.permissions.filter((permission) => permission.startsWith('allow-')).forEach((permission) => {
            expect(['allow-ui-overlay-ready', 'allow-submit-ui-overlay-action']).toContain(permission);
        });

        ['render-surface.json'].forEach((fileName) => {
            const child = JSON.parse(read(`src-tauri/capabilities/${fileName}`));
            expect(child.permissions.some((permission) => permission.startsWith('allow-'))).toBe(false);
        });
    });

    it('bundles Lucide instead of executing a mutable remote script in child WebViews', () => {
        expect(read('index.html')).toContain('./vendor/lucide.min.js');
        expect(read('src-tauri/src/demo-template/shell.html')).toContain('__LUCIDE_SCRIPT__');
        expect(read('src-tauri/src/demo-template/shell.html')).not.toContain('unpkg.com/lucide');
        expect(existsSync(path.join(root, 'vendor/lucide.min.js'))).toBe(true);
    });

    it('presents adopted overlays through a native receipt without child focus or emit grants', () => {
        const overlayCommands = read('src-tauri/src/app/ui_overlay/commands.rs');
        expect(overlayCommands).toContain('"ui-overlay:presented"');
        expect(overlayCommands).toContain('serde_json::json!({ "epoch": active.epoch })');
        expect(overlayCommands).not.toContain('webview.set_focus()');

        const overlay = JSON.parse(read('src-tauri/capabilities/ui-overlay.json'));
        expect(overlay.permissions).not.toContain('core:event:allow-emit');
        expect(overlay.permissions).not.toContain('core:event:allow-emit-to');
    });
});
