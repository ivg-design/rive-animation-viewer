import { createMediaCommands } from './commands/media.js';
import { createStatusPlaybackCommands } from './commands/status-playback.js';
import { createViewModelCommands } from './commands/view-model.js';
import { createEditorConsoleCommands } from './commands/editor-console.js';
import { createExportWorkspaceCommands } from './commands/export-workspace.js';
import { createVmInstanceCommands } from './commands/vm-instance.js';
import { createGlobalViewModelCommands } from './commands/global-view-model.js';
import { createCanvasScreenshotCommands } from './commands/canvas-screenshot.js';

export function createMcpCommandHandlers({
    assertMcpScriptAccess,
    buildViewModelSnapshot,
    documentRef = globalThis.document,
    getCanvasBackgroundStateSnapshot,
    getRenderSurfaceController,
    renderSurfaceController,
    windowRef = globalThis.window,
} = {}) {
    const handlers = {
        ...createStatusPlaybackCommands({ buildViewModelSnapshot, documentRef, getCanvasBackgroundStateSnapshot, getRenderSurfaceController, renderSurfaceController, windowRef }),
        ...createViewModelCommands({ buildViewModelSnapshot, documentRef, getRenderSurfaceController, renderSurfaceController, windowRef }),
        ...createGlobalViewModelCommands({ documentRef, getRenderSurfaceController, renderSurfaceController, windowRef }),
        ...createVmInstanceCommands({ getRenderSurfaceController, renderSurfaceController, windowRef }),
        ...createEditorConsoleCommands({ assertMcpScriptAccess, documentRef, getRenderSurfaceController, renderSurfaceController, windowRef }),
        ...createExportWorkspaceCommands({ documentRef, windowRef }),
        ...createCanvasScreenshotCommands({ documentRef, windowRef }),
        ...createMediaCommands({ windowRef }),
    };
    return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, async (...args) => {
        const result = await handler(...args);
        if (result?.applied === false) throw new Error(result.message || result.error || `Command ${result.status || 'rejected'}.`);
        if (!result || typeof result !== 'object' || !('commandType' in result || 'canonicalState' in result)) return result;
        const { canonicalState, canonicalDelta: _delta, commandPayload: _payload, ...receipt } = result;
        return { ...receipt, ...(canonicalState?.playback ? { playback: canonicalState.playback } : {}) };
    }]));
}
