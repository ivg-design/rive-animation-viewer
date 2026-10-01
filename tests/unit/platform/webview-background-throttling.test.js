import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const sourceRoot = path.join(process.cwd(), 'src-tauri/src');
// The isolated playback window is a standalone demo; no host command awaits it.
const UNAWAITED_WINDOWS = new Set(['app/isolated_playback.rs']);

function rustSources(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return rustSources(fullPath);
        return entry.name.endsWith('.rs') ? [fullPath] : [];
    });
}

describe('webview background throttling', () => {
    it('keeps every command-serving webview running while the RAV window is hidden', () => {
        const builders = rustSources(sourceRoot).flatMap((file) => {
            const relative = path.relative(sourceRoot, file);
            const source = readFileSync(file, 'utf8');
            return [...source.matchAll(/Webview(?:Window)?Builder::new\(/g)]
                .map((match) => ({ relative, chain: source.slice(match.index, source.indexOf(';', match.index)) }));
        });
        const served = builders.filter(({ relative }) => !UNAWAITED_WINDOWS.has(relative));

        expect(served.map(({ relative }) => relative).sort()).toEqual([
            'app/render_surface/activation/watchdog.rs',
            'app/render_surface/creation.rs',
            'app/ui_overlay/support.rs',
        ]);
        for (const { relative, chain } of served) {
            expect(chain, relative).toMatch(/\.background_throttling\((?:[\w:]+::)?WEBVIEW_BACKGROUND_THROTTLING\)/);
        }
        expect(readFileSync(path.join(sourceRoot, 'app/constants.rs'), 'utf8'))
            .toMatch(/WEBVIEW_BACKGROUND_THROTTLING[^;]*BackgroundThrottlingPolicy::Disabled;/);
    });

    it('configures the main window with the same policy on every platform config', () => {
        const configs = readdirSync(path.join(process.cwd(), 'src-tauri'))
            .filter((name) => /^tauri(\..+)?\.conf\.json$/.test(name))
            .map((name) => [name, JSON.parse(readFileSync(path.join(process.cwd(), 'src-tauri', name), 'utf8'))])
            .filter(([, config]) => Array.isArray(config.app?.windows));

        expect(configs.map(([name]) => name).sort()).toEqual([
            'tauri.conf.json',
            'tauri.flicker-test.conf.json',
            'tauri.windows.conf.json',
        ]);
        for (const [name, config] of configs) {
            const main = config.app.windows.find((window) => window.label === 'main');
            expect(main?.backgroundThrottling, name).toBe('disabled');
        }
    });
});
