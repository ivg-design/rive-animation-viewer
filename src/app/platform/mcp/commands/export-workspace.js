import { normalizeControlSelectionKey } from '../../../rive/vm-controls.js';

export function createExportWorkspaceCommands({
    documentRef = globalThis.document,
    windowRef = globalThis.window,
} = {}) {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));

    return {
        async rav_open_isolated_playback() {
            if (typeof windowRef._mcpOpenIsolatedPlayback !== 'function') {
                throw new Error('Isolated playback is not available');
            }
            return windowRef._mcpOpenIsolatedPlayback();
        },

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

        async rav_export_demo_visual({
            output_path,
            selection,
            package_source,
            snippet_mode,
            step_delay_ms = 250,
        } = {}) {
            if (!output_path) throw new Error('output_path is required');
            if (typeof windowRef._mcpToggleInstantiationControlsDialog !== 'function') {
                throw new Error('Instantiation controls dialog binding not available');
            }
            if (typeof windowRef._mcpExportDemoToPath !== 'function') {
                throw new Error('Export-to-path binding not available');
            }

            await windowRef._mcpToggleInstantiationControlsDialog('open');
            await sleep(step_delay_ms);
            try {
                let configuredState = null;
                if (typeof windowRef._mcpConfigureInstantiationControls === 'function') {
                    if (selection !== undefined) {
                        configuredState = await windowRef._mcpConfigureInstantiationControls({ selection });
                        await sleep(step_delay_ms);
                    }
                    if (package_source) {
                        configuredState = await windowRef._mcpConfigureInstantiationControls({
                            packageSource: package_source,
                        });
                        await sleep(step_delay_ms);
                    }
                    if (snippet_mode) {
                        configuredState = await windowRef._mcpConfigureInstantiationControls({
                            snippetMode: snippet_mode,
                        });
                        await sleep(step_delay_ms);
                    }
                    configuredState = await windowRef._mcpConfigureInstantiationControls({});
                } else {
                    if (selection === 'all') {
                        documentRef.getElementById('instantiation-preset-all-btn')?.click();
                    } else if (selection === 'changed') {
                        documentRef.getElementById('instantiation-preset-changed-btn')?.click();
                    } else if (selection === 'none') {
                        documentRef.getElementById('instantiation-preset-none-btn')?.click();
                    } else if (Array.isArray(selection)) {
                        const tree = documentRef.getElementById('instantiation-controls-tree');
                        if (!tree) throw new Error('Controls tree not in DOM');
                        const availableKeys = new Set(Array.from(tree.querySelectorAll(
                            'input[type="checkbox"][data-control-key]',
                        )).map((checkbox) => checkbox.getAttribute('data-control-key')).filter(Boolean));
                        const normalizedKeys = selection.map((key) => ({
                            original: key,
                            normalized: normalizeControlSelectionKey(key),
                        }));
                        const unmatchedKeys = normalizedKeys.filter(({ normalized }) => (
                            !normalized || !availableKeys.has(normalized)
                        ));
                        if (unmatchedKeys.length) {
                            throw new Error(`Unknown control selection key(s): ${unmatchedKeys
                                .map(({ original }) => String(original))
                                .join(', ')}`);
                        }
                        documentRef.getElementById('instantiation-preset-none-btn')?.click();
                        for (const key of new Set(normalizedKeys.map(({ normalized }) => normalized))) {
                            const checkbox = Array.from(tree.querySelectorAll(
                                'input[type="checkbox"][data-control-key]',
                            )).find((candidate) => candidate.getAttribute('data-control-key') === key);
                            if (checkbox && !checkbox.checked) checkbox.click();
                        }
                    }
                    if (selection !== undefined) await sleep(step_delay_ms);

                    if (package_source) {
                        const select = documentRef.getElementById('instantiation-package-source-select');
                        if (select) {
                            select.value = package_source;
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                            await sleep(step_delay_ms);
                        }
                    }

                    if (snippet_mode) {
                        const select = documentRef.getElementById('instantiation-snippet-mode-select');
                        if (select) {
                            select.value = snippet_mode;
                            select.dispatchEvent(new Event('change', { bubbles: true }));
                            await sleep(step_delay_ms);
                        }
                    }
                }

                const exportBtn = documentRef.getElementById('instantiation-dialog-export-btn');
                if (exportBtn) {
                    exportBtn.classList.add('is-pressing');
                    await sleep(150);
                    exportBtn.classList.remove('is-pressing');
                }

                const packageSourceSelect = documentRef.getElementById('instantiation-package-source-select');
                const snippetModeSelect = documentRef.getElementById('instantiation-snippet-mode-select');
                const selectedControlKeys = configuredState?.selectedControlKeys || Array.from(new Set(Array.from(
                    documentRef.querySelectorAll(
                        '#instantiation-controls-tree input[type="checkbox"][data-control-key]:checked',
                    ),
                ).map((checkbox) => checkbox.getAttribute('data-control-key')).filter(Boolean)));
                const savedPath = await windowRef._mcpExportDemoToPath(output_path, {
                    packageSource: configuredState?.packageSource
                        || (packageSourceSelect?.value === 'local' ? 'local' : 'cdn'),
                    selectedControlKeys,
                    snippetMode: configuredState?.snippetMode
                        || (snippetModeSelect?.value === 'scaffold' ? 'scaffold' : 'compact'),
                });
                await windowRef._mcpToggleInstantiationControlsDialog('close');

                return { ok: true, path: savedPath };
            } catch (error) {
                await windowRef._mcpToggleInstantiationControlsDialog('close');
                throw error;
            }
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
