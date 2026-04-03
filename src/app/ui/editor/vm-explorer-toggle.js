import {
    DEFAULT_EDITOR_ONLOAD_BLOCK,
} from '../../snippets/editor-defaults.js';
import {
    VM_EXPLORER_ONLOAD_BLOCK,
} from '../../snippets/vm-explorer.js';
import {
    hasVmExplorerSnippet,
    replaceOnLoadBlock,
} from './editor-code-utils.js';

export async function setVmExplorerSnippetEnabledOnEditor({
    editorView,
    enabled,
    getTauriInvoker = () => null,
    markDraftState = () => {},
    setEditorCode = () => false,
    showError = () => {},
    updateInfo = () => {},
} = {}, { openDevtools = false } = {}) {
    if (!editorView) {
        showError('Code editor is not available');
        return { ok: false, injected: false };
    }

    const invoke = getTauriInvoker();
    if (openDevtools && invoke) {
        try {
            await invoke('open_devtools');
        } catch {
            /* noop */
        }
    }

    try {
        const currentCode = editorView.state.doc.toString();
        const snippetInjected = hasVmExplorerSnippet(currentCode);
        if (snippetInjected === Boolean(enabled)) {
            return { ok: true, changed: false, injected: snippetInjected };
        }

        let newCode;
        if (!enabled) {
            newCode = replaceOnLoadBlock(currentCode, DEFAULT_EDITOR_ONLOAD_BLOCK);
            updateInfo('VM explorer removed — restored default');
            console.log('VM explorer removed. Default onLoad restored.');
        } else {
            if (!VM_EXPLORER_ONLOAD_BLOCK) {
                showError('Could not load VM explorer snippet');
                return;
            }

            newCode = replaceOnLoadBlock(currentCode, VM_EXPLORER_ONLOAD_BLOCK);
            updateInfo('VM explorer injected — click Apply & Reload');
            console.log('%cVM Explorer injected. Click Apply & Reload to activate.', 'color: #C4F82A; font-weight: bold');
            console.log('After reload: vmExplore(), vmGet("path"), vmSet("path", val), vmFire("path")');
        }

        if (!newCode || newCode === currentCode) {
            showError('Could not modify onLoad block — check editor code syntax');
            return;
        }

        setEditorCode(newCode);
        markDraftState(true);
        return { ok: true, changed: true, injected: Boolean(enabled) };
    } catch (error) {
        showError(`Failed to modify code: ${error.message}`);
        throw error;
    }
}
