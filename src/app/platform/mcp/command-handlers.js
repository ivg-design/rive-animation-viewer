import { createStatusPlaybackCommands } from './commands/status-playback.js';
import { createViewModelCommands } from './commands/view-model.js';
import { createEditorConsoleCommands } from './commands/editor-console.js';
import { createExportWorkspaceCommands } from './commands/export-workspace.js';

export function createMcpCommandHandlers({
    assertMcpScriptAccess,
    buildViewModelSnapshot,
    documentRef = globalThis.document,
    windowRef = globalThis.window,
} = {}) {
    return {
        ...createStatusPlaybackCommands({ buildViewModelSnapshot, documentRef, windowRef }),
        ...createViewModelCommands({ buildViewModelSnapshot, documentRef, windowRef }),
        ...createEditorConsoleCommands({ assertMcpScriptAccess, documentRef, windowRef }),
        ...createExportWorkspaceCommands({ documentRef, windowRef }),
    };
}
