import { createSafeInspectPreview } from '../../../core/safe-inspect.js';
import { getAuthoritativeRenderSurface } from '../authoritative.js';

const EVAL_TARGETS = new Set(['auto', 'host', 'playback']);

function normalizeEvalTarget(target) {
    const normalized = target == null ? 'auto' : String(target).trim().toLowerCase();
    if (!EVAL_TARGETS.has(normalized)) {
        throw new Error("target must be 'auto', 'host', or 'playback'");
    }
    return normalized;
}

function hostEvalResult(value, requestedTarget, windowRef) {
    const result = value === undefined
        ? 'undefined'
        : value === null
            ? 'null'
            : createSafeInspectPreview(value, { windowRef });
    return {
        requestedTarget,
        result,
        sessionId: null,
        surface: 'host-webview',
        target: 'host',
    };
}

async function playbackEvalResult(authoritative, expression, requestedTarget) {
    const { controller, state } = authoritative;
    const request = typeof controller.requestActiveCommand === 'function'
        ? controller.requestActiveCommand('eval', { expression })
        : controller.requestCommand('eval', { expression }, { targetSessionId: state.activeSessionId });
    const response = await request;
    if (!response?.applied || response.status !== 'applied') {
        const reason = response?.message || response?.status || 'unavailable';
        throw new Error(`Playback eval was not applied: ${reason}`);
    }
    if (!response.result || !Object.prototype.hasOwnProperty.call(response.result, 'result')) {
        throw new Error('Playback eval returned no bounded result preview');
    }
    return {
        requestedTarget,
        result: response.result.result,
        sessionId: response.targetSessionId || state.activeSessionId,
        surface: 'isolated-render-surface',
        target: 'playback',
    };
}

export function createEditorConsoleCommands({
    assertMcpScriptAccess,
    documentRef = globalThis.document,
    getRenderSurfaceController,
    renderSurfaceController,
    windowRef = globalThis.window,
} = {}) {
    return {
        async rav_get_event_log({ limit = 50, source = 'all' } = {}) {
            const entries = windowRef._mcpGetEventLog?.() || [];
            const filtered = source && source !== 'all'
                ? entries.filter((entry) => entry.source === source)
                : entries;
            // Event logs are appended in chronological order. Return the most
            // recent window while retaining that order within the window.
            const selected = limit > 0 ? filtered.slice(-limit) : [];
            return {
                total: entries.length,
                returned: selected.length,
                entries: selected
                    .map((entry) => createSafeInspectPreview(entry, {
                        maxArrayItems: 24,
                        maxDepth: 4,
                        maxObjectKeys: 32,
                        windowRef,
                    })),
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
            if (typeof windowRef._mcpSetRuntime === 'function') {
                const result = await windowRef._mcpSetRuntime(runtime);
                return {
                    ...(result && typeof result === 'object' ? result : {}),
                    ok: true,
                    runtime,
                };
            }
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

        async rav_set_alignment({ alignment }) {
            if (!alignment) throw new Error('alignment is required');
            const select = documentRef.getElementById('alignment-select');
            if (!select) throw new Error('Alignment selector not found');
            select.value = alignment;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, alignment };
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
                throw new Error('Transparent canvas background control not found');
            }
            input.value = color;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return { ok: true, color };
        },

        async rav_set_canvas_size({
            mode = 'fixed',
            width,
            height,
            lockAspectRatio,
        } = {}) {
            if (typeof windowRef._mcpSetCanvasSizing !== 'function') {
                throw new Error('Canvas sizing controls not available');
            }

            const normalizedMode = mode === 'auto' ? 'auto' : 'fixed';
            const nextState = await windowRef._mcpSetCanvasSizing({
                mode: normalizedMode,
                width,
                height,
                lockAspectRatio,
            }, normalizedMode === 'fixed'
                ? 'Canvas size updated from MCP'
                : 'Canvas sizing set to auto from MCP');

            return {
                ok: true,
                canvasSize: nextState,
            };
        },

        async rav_eval({ expression, target = 'auto' } = {}) {
            assertMcpScriptAccess('rav_eval', windowRef);
            if (typeof expression !== 'string' || !expression.trim()) throw new Error('expression is required');
            const requestedTarget = normalizeEvalTarget(target);
            const authoritative = getAuthoritativeRenderSurface({
                getRenderSurfaceController,
                renderSurfaceController,
                windowRef,
            });
            try {
                if (requestedTarget !== 'host' && authoritative) {
                    return await playbackEvalResult(authoritative, expression, requestedTarget);
                }
                if (requestedTarget === 'playback') {
                    throw new Error('No active authoritative playback surface is available');
                }
                // eslint-disable-next-line no-eval
                const result = await eval(expression);
                return hostEvalResult(result, requestedTarget, windowRef);
            } catch (error) {
                throw new Error(`Eval error: ${error.message}`);
            }
        },

        async rav_console_open({ mode = 'js', level, sources, search } = {}) {
            if (typeof windowRef._mcpConsoleOpen !== 'function') throw new Error('Console not available');
            const normalizedMode = mode === 'events' ? 'events' : 'js';
            if (typeof windowRef._mcpSetConsoleMode === 'function') {
                await windowRef._mcpSetConsoleMode(normalizedMode);
            } else {
                await windowRef._mcpConsoleOpen();
            }
            if ((level !== undefined || sources !== undefined || search !== undefined)
                && typeof windowRef._mcpSetConsoleFilter === 'function') {
                windowRef._mcpSetConsoleFilter({ mode: normalizedMode, level, sources, search });
            }
            return { ok: true, open: true, mode: normalizedMode };
        },

        async rav_console_close() {
            if (typeof windowRef._mcpConsoleClose !== 'function') throw new Error('Console not available');
            return windowRef._mcpConsoleClose();
        },

        async rav_console_set_mode({ mode } = {}) {
            if (mode !== 'events' && mode !== 'js' && mode !== 'closed') {
                throw new Error("mode must be 'events', 'js', or 'closed'");
            }
            if (typeof windowRef._mcpSetConsoleMode !== 'function') {
                throw new Error('Console mode binding not available');
            }
            return windowRef._mcpSetConsoleMode(mode);
        },

        async rav_console_set_filter({ mode, level, sources, search } = {}) {
            if (typeof windowRef._mcpSetConsoleFilter !== 'function') {
                throw new Error('Console filter binding not available');
            }
            return windowRef._mcpSetConsoleFilter({ mode, level, sources, search });
        },

        async rav_console_clear({ mode } = {}) {
            if (typeof windowRef._mcpConsoleClear !== 'function') {
                throw new Error('Console clear binding not available');
            }
            return windowRef._mcpConsoleClear(mode);
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
