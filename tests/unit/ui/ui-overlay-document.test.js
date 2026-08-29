import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

describe('native UI overlay document', () => {
    it('keeps every migrated overlay visible when its bounded section is selected', () => {
        const css = read('styles/11-ui-overlay.css');
        const baseCss = read('styles/00-base.css');
        expect(css).toContain('@import url("./01-header.css")');
        expect(baseCss).toContain('.ui-overlay-root *::-webkit-scrollbar-corner');
        expect(css).toMatch(
            /\.ui-overlay-dialog:not\(\[hidden\]\)\s*>\s*\.mcp-setup-content[\s\S]*?display:\s*flex/,
        );
        expect(css).toMatch(
            /\.ui-overlay-dialog:not\(\[hidden\]\)\s*>\s*\.instantiation-controls-content[\s\S]*?display:\s*flex/,
        );
    });

    it('exposes bounded dialog semantics without forcing initial control focus', () => {
        const html = read('overlay.html');
        const css = read('styles/11-ui-overlay.css');
        const nativeSupport = read('src-tauri/src/app/ui_overlay/support.rs');
        const controlCss = read('styles/01-header-controls.css');
        for (const id of ['settings', 'about', 'mcp', 'export']) {
            expect(html).toMatch(new RegExp(
                `id="ui-overlay-${id}"[^>]*role="dialog"[^>]*aria-modal="true"`,
            ));
        }
        expect(html).not.toContain('data-overlay-autofocus');
        expect(html.match(/class="[^"]*ui-overlay-close[^"]*"/g)?.length).toBe(3);
        expect(css).toMatch(/\.ui-overlay-dialog\s*\{[\s\S]*?border:\s*1px solid var\(--ui-overlay-frame\)/);
        expect(css).toContain('--radius-md: 8px');
        expect(nativeSupport).toContain('UI_OVERLAY_CORNER_RADIUS: f64 = 8.0');
        expect(nativeSupport).toContain('layer.setCornerRadius(UI_OVERLAY_CORNER_RADIUS)');
        expect(nativeSupport).toContain('layer.setMasksToBounds(true)');
        expect(controlCss).toMatch(/\.rav-modal-close\s*\{[\s\S]*?width:\s*44px[\s\S]*?border:\s*1px solid var\(--dialog-frame\)/);
        expect(controlCss).toMatch(/\.rav-modal-close:focus-visible\s*\{[\s\S]*?outline:\s*none[\s\S]*?box-shadow:/);
    });

    it('keeps MCP chrome fixed while only its padded body scrolls', () => {
        const css = read('styles/05-mcp-dialog.css');
        expect(css).toMatch(/\.mcp-setup-content\s*\{[\s\S]*?overflow:\s*hidden/);
        expect(css).toMatch(/\.mcp-setup-content::after\s*\{[\s\S]*?flex:\s*0 0 12px/);
        expect(css).toMatch(/\.mcp-setup-body\s*\{[\s\S]*?padding:\s*16px 20px 32px[\s\S]*?overflow-y:\s*auto/);
        expect(css).toContain('scroll-padding: 16px 0 32px');
    });

    it('keeps About body static at full size, scrollable only when constrained, and uses shared chrome', () => {
        const overlayCss = read('styles/11-ui-overlay.css');
        const settingsCss = read('styles/02-settings.css');
        const mcpCss = read('styles/05-mcp-dialog.css');
        const exportCss = read('styles/05-instantiation-dialog.css');
        const aboutCss = read('styles/10-about-dialog.css');
        const dialogs = read('src/app/bootstrap/dom/dialogs.js');
        const about = read('src/app/ui/about/about-dialog.js');
        expect(overlayCss).toMatch(
            /\.ui-overlay-dialog\s*>\s*\.about-dialog-content\s*>\s*\.about-dialog-body\s*\{[\s\S]*?flex:\s*1 1 auto[\s\S]*?overflow:\s*hidden/,
        );
        expect(overlayCss).toMatch(
            /@media\s*\(max-width:\s*720px\)[\s\S]*?\.about-dialog-body\s*\{[\s\S]*?overflow-y:\s*auto/,
        );
        expect(overlayCss).not.toMatch(
            /@media[^\{]*max-height[^\{]*\{[\s\S]*?\.about-dialog-body\s*\{[\s\S]*?(?:grid-template-columns|overflow-y)/,
        );
        expect(aboutCss).not.toMatch(
            /@media[^\{]*max-height[^\{]*\{[\s\S]*?\.about-dialog-body\s*\{[\s\S]*?(?:grid-template-columns|overflow-y)/,
        );
        expect(dialogs.match(/rav-modal-close/g)?.length).toBe(2);
        expect(about).toContain('rav-modal-close about-dialog-close');
        for (const css of [settingsCss, mcpCss, exportCss, aboutCss]) {
            expect(css).toContain('border: 1px solid var(--dialog-frame)');
        }
    });

    it('uses the authenticated native action command instead of generic child event emission', () => {
        const entry = read('src/app/ui/overlay/entry.js');
        const actionClient = read('src/app/ui/overlay/action-client.js');
        const settingsRenderer = read('src/app/ui/overlay/settings-renderer.js');
        expect(actionClient).toContain("invoke('submit_ui_overlay_action'");
        expect(entry).toContain("invoke('ui_overlay_ready'");
        expect(entry).not.toContain("events?.listen?.('ui-overlay:presented'");
        expect(entry).toContain("emitAction('selection-toggle'");
        expect(entry).toContain("emitAction('branch-selection'");
        expect(settingsRenderer).toContain("emitAction('default-riv-app-apply'");
        expect(settingsRenderer).toContain('defaultRivApp.handlerName ||');
        expect(entry).not.toContain("invoke('make_rav_default_for_riv'");
        expect(entry).not.toContain("invoke('get_riv_default_app_status'");
        expect(entry).not.toContain("emitAction('selection-replace'");
        expect(`${entry}\n${settingsRenderer}\n${actionClient}`).not.toContain('events.emitTo');
    });

    it('keeps Default .riv App compact and preserves Anonymous Usage directly above About', () => {
        const fallback = read('index.html');
        const native = read('overlay.html');
        const settingsCss = read('styles/02-settings.css');
        const assertBaseOrdering = (html) => {
            expect(html.indexOf('id="default-riv-app-action-btn"')).toBeGreaterThan(html.indexOf('id="canvas-size-aspect-value"'));
            expect(html.indexOf('id="default-riv-app-action-btn"')).toBeLessThan(html.indexOf('id="install-counter-enabled-btn"'));
        };
        assertBaseOrdering(fallback);
        assertBaseOrdering(native);
        expect(native.indexOf('id="install-counter-enabled-btn"')).toBeLessThan(native.indexOf('settings-row-about'));
        expect(settingsCss).toContain('.settings-controls-default-riv-app');
        expect(settingsCss).toContain('min-width: 218px;');
    });

    it('keeps native Settings static unless its measured content actually overflows', () => {
        const css = read('styles/11-ui-overlay.css');
        const entry = read('src/app/ui/overlay/entry.js');
        const settingsRenderer = read('src/app/ui/overlay/settings-renderer.js');
        expect(css).toMatch(
            /\.ui-overlay-settings-body\s*\{[\s\S]*?overflow:\s*hidden/,
        );
        expect(css).toMatch(
            /\.ui-overlay-settings-body\.is-scroll-constrained\s*\{[\s\S]*?overflow-y:\s*auto/,
        );
        expect(settingsRenderer).toContain('body.scrollHeight > body.clientHeight + 2');
        expect(entry).toContain("window.addEventListener('resize', settingsRenderer.scheduleOverflowSync)");
    });
});
