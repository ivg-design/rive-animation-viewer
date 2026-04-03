export function createExportWorkspaceCommands({
    windowRef = globalThis.window,
} = {}) {
    return {
        async rav_export_demo({ output_path } = {}) {
            if (output_path && typeof windowRef._mcpExportDemoToPath === 'function') {
                return { ok: true, path: await windowRef._mcpExportDemoToPath(output_path) };
            }
            if (!output_path && typeof windowRef.createDemoBundle === 'function') {
                const result = await windowRef.createDemoBundle();
                return { ok: true, result: result || 'Demo export initiated (save dialog opened)' };
            }
            throw new Error('Export not available');
        },

        async generate_web_instantiation_code({ package_source = 'cdn', snippet_mode = 'compact' } = {}) {
            if (typeof windowRef._mcpGenerateWebInstantiationCode !== 'function') {
                throw new Error('Web instantiation generator not available');
            }
            return windowRef._mcpGenerateWebInstantiationCode(package_source, snippet_mode);
        },

        async rav_toggle_instantiation_controls_dialog({ action = 'toggle' } = {}) {
            if (typeof windowRef._mcpToggleInstantiationControlsDialog !== 'function') {
                throw new Error('Instantiation controls dialog not available');
            }
            return windowRef._mcpToggleInstantiationControlsDialog(action);
        },

        async rav_configure_workspace({
            left_sidebar,
            right_sidebar,
            source_mode,
            vm_explorer,
        } = {}) {
            let sidebars = windowRef._mcpGetSidebarVisibility?.() || { left: false, right: true };
            if (left_sidebar !== undefined || right_sidebar !== undefined) {
                if (typeof windowRef._mcpSetSidebarVisibility !== 'function') {
                    throw new Error('Sidebar visibility controls are not available');
                }
                sidebars = windowRef._mcpSetSidebarVisibility({
                    ...(left_sidebar !== undefined ? { left: left_sidebar === 'open' } : {}),
                    ...(right_sidebar !== undefined ? { right: right_sidebar === 'open' } : {}),
                }) || sidebars;
            }

            let liveConfigState = windowRef._mcpGetLiveConfigState?.() || { sourceMode: 'internal', draftDirty: false };
            if (source_mode !== undefined) {
                if (!['internal', 'editor'].includes(source_mode)) {
                    throw new Error('source_mode must be "internal" or "editor"');
                }
                if (typeof windowRef._mcpSetLiveConfigSource !== 'function') {
                    throw new Error('Live config source controls are not available');
                }
                liveConfigState = await windowRef._mcpSetLiveConfigSource(source_mode);
            }

            let vmExplorerState = windowRef._mcpGetVmExplorerSnippetState?.() || { injected: false };
            if (vm_explorer !== undefined) {
                if (!['inject', 'remove'].includes(vm_explorer)) {
                    throw new Error('vm_explorer must be "inject" or "remove"');
                }
                if (typeof windowRef._mcpSetVmExplorerSnippetEnabled !== 'function') {
                    throw new Error('VM Explorer snippet controls are not available');
                }
                vmExplorerState = await windowRef._mcpSetVmExplorerSnippetEnabled(vm_explorer === 'inject');
            }

            return {
                sidebars,
                sourceMode: liveConfigState?.sourceMode || 'internal',
                draftDirty: Boolean(liveConfigState?.draftDirty),
                vmExplorerInjected: Boolean(vmExplorerState?.injected),
            };
        },
    };
}
