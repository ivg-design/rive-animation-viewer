import { createStatusPlaybackCommands } from './commands/status-playback.js';
import { createViewModelCommands } from './commands/view-model.js';
import { createEditorConsoleCommands } from './commands/editor-console.js';
import { createExportWorkspaceCommands } from './commands/export-workspace.js';
import { createVmInstanceCommands } from './commands/vm-instance.js';

export function createMcpCommandHandlers({
    assertMcpScriptAccess,
    buildViewModelSnapshot,
    documentRef = globalThis.document,
    getCanvasBackgroundStateSnapshot,
    getRenderSurfaceController,
    renderSurfaceController,
    windowRef = globalThis.window,
} = {}) {
    return {
        ...createStatusPlaybackCommands({ buildViewModelSnapshot, documentRef, getCanvasBackgroundStateSnapshot, getRenderSurfaceController, renderSurfaceController, windowRef }),
        ...createViewModelCommands({ buildViewModelSnapshot, documentRef, getRenderSurfaceController, renderSurfaceController, windowRef }),
        ...createVmInstanceCommands({ getRenderSurfaceController, renderSurfaceController, windowRef }),
        ...createEditorConsoleCommands({ assertMcpScriptAccess, documentRef, windowRef }),
        ...createExportWorkspaceCommands({ documentRef, windowRef }),
    };
}
