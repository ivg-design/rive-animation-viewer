import { createSafeInspectPreview } from '../../../core/safe-inspect.js';

export function createEditorConsoleCommands({
    assertMcpScriptAccess,
    documentRef = globalThis.document,
    windowRef = globalThis.window,
} = {}) {
    return {
        async rav_get_event_log({ limit = 50, source = 'all' } = {}) {
            const entries = windowRef._mcpGetEventLog?.() || [];
            const filtered = source && source !== 'all'
                ? entries.filter((entry) => entry.source === source)
                : entries;
            return {
                total: entries.length,
                returned: Math.min(limit, filtered.length),
                entries: filtered.slice(0, limit),
            };
        },

        async rav_get_editor_code() {
            const code = await windowRef._mcpGetEditorCode?.();
            if (code !== undefined) {
                return { code };
            }
            throw new Error('Editor not available');
        },

        async rav_set_editor_code({ code }) {
            if (typeof code !== 'string') throw new Error('code must be a string');
            if (typeof windowRef._mcpSetEditorCode !== 'function') throw new Error('Editor not available');
            const applied = await windowRef._mcpSetEditorCode(code);
            if (applied === false) {
                throw new Error('Editor not available');
            }
            return { ok: true };
        },

        async rav_apply_code() {
            assertMcpScriptAccess('rav_apply_code', windowRef);
            if (typeof windowRef.applyCodeAndReload !== 'function') throw new Error('applyCodeAndReload not available');
            await windowRef.applyCodeAndReload();
            return { ok: true };
        },

        async rav_set_runtime({ runtime }) {
            if (!runtime) throw new Error('runtime is required');
            const select = documentRef.getElementById('runtime-select');
            if (!select) throw new Error('Runtime selector not found');
            select.value = runtime;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, runtime };
        },

        async rav_set_layout({ fit }) {
            if (!fit) throw new Error('fit is required');
            const select = documentRef.getElementById('layout-select');
            if (!select) throw new Error('Layout selector not found');
            select.value = fit;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, fit };
        },

        async rav_set_canvas_color({ color }) {
            if (!color) throw new Error('color is required');
            const input = documentRef.getElementById('canvas-color-input');
            if (!input) throw new Error('Canvas color input not found');
            if (color === 'transparent') {
                const button = documentRef.getElementById('canvas-color-reset-btn');
                if (button) {
                    button.click();
                    return { ok: true, color: 'transparent' };
                }
                throw new Error('Canvas transparency toggle not found');
            }
            input.value = color;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return { ok: true, color };
        },

        async rav_eval({ expression }) {
            assertMcpScriptAccess('rav_eval', windowRef);
            if (!expression) throw new Error('expression is required');
            try {
                // eslint-disable-next-line no-eval
                const result = await eval(expression);
                if (result === undefined) return { result: 'undefined' };
                if (result === null) return { result: 'null' };
                return { result: createSafeInspectPreview(result, { windowRef }) };
            } catch (error) {
                throw new Error(`Eval error: ${error.message}`);
            }
        },

        async rav_console_open() {
            if (typeof windowRef._mcpConsoleOpen !== 'function') throw new Error('Console not available');
            return windowRef._mcpConsoleOpen();
        },

        async rav_console_close() {
            if (typeof windowRef._mcpConsoleClose !== 'function') throw new Error('Console not available');
            return windowRef._mcpConsoleClose();
        },

        async rav_console_read({ limit = 50 } = {}) {
            if (typeof windowRef._mcpConsoleRead !== 'function') throw new Error('Console not available');
            return windowRef._mcpConsoleRead(limit);
        },

        async rav_console_exec({ code }) {
            assertMcpScriptAccess('rav_console_exec', windowRef);
            if (!code) throw new Error('code is required');
            if (typeof windowRef._mcpConsoleExec !== 'function') throw new Error('Console not available');
            return windowRef._mcpConsoleExec(code);
        },
    };
}
