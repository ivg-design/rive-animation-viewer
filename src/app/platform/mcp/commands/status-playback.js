import { getTauriInvoker } from '../bridge-port.js';

export function createStatusPlaybackCommands({
    buildViewModelSnapshot,
    documentRef = globalThis.document,
    windowRef = globalThis.window,
} = {}) {
    function buildSafeArtboardState(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') {
            return null;
        }
        return {
            currentArtboard: snapshot.currentArtboard || null,
            currentPlaybackName: snapshot.currentPlaybackName || null,
            currentPlaybackType: snapshot.currentPlaybackType || null,
            defaultArtboard: snapshot.defaultArtboard || null,
            defaultPlaybackKey: snapshot.defaultPlaybackKey || null,
        };
    }

    return {
        async rav_status() {
            const inst = windowRef.riveInst;
            const vmSnapshot = buildViewModelSnapshot(windowRef);
            const liveConfigState = windowRef._mcpGetLiveConfigState?.() || { draftDirty: false, sourceMode: 'internal' };
            return {
                connected: true,
                file: {
                    name: windowRef.__riveAnimationCache?.getName() || null,
                    loaded: Boolean(inst),
                    sizeBytes: inst ? (windowRef.__riveAnimationCache?.getBuffer()?.byteLength || 0) : 0,
                },
                runtime: {
                    name: documentRef.getElementById('runtime-select')?.value || 'unknown',
                    version: windowRef.__riveRuntimeCache?.getRuntimeVersion() || 'unknown',
                },
                playback: {
                    isPlaying: inst ? inst.isPlaying : false,
                    isPaused: inst ? inst.isStopped || !inst.isPlaying : true,
                },
                layout: {
                    fit: documentRef.getElementById('layout-select')?.value || 'contain',
                    alignment: documentRef.getElementById('alignment-select')?.value || 'center',
                    canvasColor: documentRef.getElementById('canvas-color-input')?.value || '#0d1117',
                },
                viewModel: {
                    hasRoot: vmSnapshot.hasRoot,
                    pathCount: vmSnapshot.paths.length,
                },
                instantiation: {
                    draftDirty: Boolean(liveConfigState.draftDirty),
                    sourceMode: liveConfigState.sourceMode || 'internal',
                },
                artboard: buildSafeArtboardState(windowRef._mcpGetArtboardState?.()) || null,
            };
        },

        async rav_switch_artboard({ artboard, playback }) {
            if (!artboard) throw new Error('artboard is required');
            if (typeof windowRef._mcpSwitchArtboard !== 'function') throw new Error('Artboard switcher not available');
            await windowRef._mcpSwitchArtboard(artboard, playback || null);
            return { ok: true, artboard, playback };
        },

        async rav_reset_artboard() {
            if (typeof windowRef._mcpResetArtboard !== 'function') throw new Error('Artboard switcher not available');
            windowRef._mcpResetArtboard();
            return { ok: true };
        },

        async rav_open_file({ path }) {
            if (!path) throw new Error('path is required');
            const invoke = getTauriInvoker(windowRef);
            if (!invoke) {
                throw new Error(
                    'File opening requires the Tauri desktop app. In the browser, drag and drop a .riv file onto the canvas instead.',
                );
            }
            const base64 = await invoke('read_riv_file', { path });
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) {
                bytes[index] = binary.charCodeAt(index);
            }
            const buffer = bytes.buffer;
            const blob = new Blob([buffer], { type: 'application/octet-stream' });
            const fileUrl = URL.createObjectURL(blob);
            const fileName = path.split('/').pop() || path.split('\\').pop() || 'unknown.riv';

            let transferredToSession = false;
            try {
                if (typeof windowRef._mcpSetCurrentFile !== 'function') throw new Error('Current file bridge is unavailable');
                if (typeof windowRef._mcpLoadAnimation !== 'function') throw new Error('Animation loader bridge is unavailable');
                windowRef._mcpSetCurrentFile(fileUrl, fileName, true, buffer, blob.type, buffer.byteLength, { sourcePath: path });
                transferredToSession = true;
                await windowRef._mcpLoadAnimation(fileUrl, fileName, { forceAutoplay: true });
                return { ok: true, file: fileName, sizeBytes: buffer.byteLength };
            } catch (error) {
                if (!transferredToSession) {
                    URL.revokeObjectURL(fileUrl);
                }
                throw error;
            }
        },

        async rav_play() {
            if (typeof windowRef.play === 'function') {
                windowRef.play();
                return { ok: true };
            }
            throw new Error('No play function available');
        },

        async rav_pause() {
            if (typeof windowRef.pause === 'function') {
                windowRef.pause();
                return { ok: true };
            }
            throw new Error('No pause function available');
        },

        async rav_reset() {
            if (typeof windowRef.reset === 'function') {
                await windowRef.reset();
                return { ok: true };
            }
            throw new Error('No reset function available');
        },

        async rav_get_artboards() {
            const inst = windowRef.riveInst;
            if (!inst) throw new Error('No animation loaded');
            const contents = inst.contents;
            if (contents?.artboards) {
                return {
                    artboards: contents.artboards.map((artboard) => (
                        typeof artboard === 'string' ? { name: artboard } : artboard
                    )),
                };
            }
            return { artboards: [{ name: inst.artboardName || '(default)' }] };
        },

        async rav_get_state_machines() {
            const inst = windowRef.riveInst;
            if (!inst) throw new Error('No animation loaded');
            const names = inst.stateMachineNames;
            if (Array.isArray(names) && names.length > 0) {
                return { stateMachines: names };
            }
            const contents = inst.contents;
            if (contents?.artboards) {
                for (const artboard of contents.artboards) {
                    if (artboard.stateMachines?.length) {
                        return { stateMachines: artboard.stateMachines.map((stateMachine) => stateMachine.name || stateMachine) };
                    }
                }
            }
            return { stateMachines: [] };
        },

        async rav_get_sm_inputs() {
            const inst = windowRef.riveInst;
            if (!inst) throw new Error('No animation loaded');
            const inputs = [];
            try {
                const smNames = Array.isArray(inst.stateMachineNames) ? inst.stateMachineNames : [];
                for (const smName of smNames) {
                    if (typeof inst.stateMachineInputs !== 'function') continue;
                    const smInputs = inst.stateMachineInputs(smName);
                    if (!Array.isArray(smInputs)) continue;
                    for (const input of smInputs) {
                        const entry = { stateMachine: smName, name: input.name, type: input.type };
                        if ('value' in input) {
                            entry.value = input.value;
                        }
                        inputs.push(entry);
                    }
                }
            } catch (error) {
                return { inputs: [], error: error.message };
            }
            return { inputs };
        },

        async rav_set_sm_input({ name, value }) {
            if (!name) throw new Error('name is required');
            const inst = windowRef.riveInst;
            if (!inst) throw new Error('No animation loaded');
            const smNames = Array.isArray(inst.stateMachineNames) ? inst.stateMachineNames : [];
            for (const smName of smNames) {
                if (typeof inst.stateMachineInputs !== 'function') continue;
                const smInputs = inst.stateMachineInputs(smName);
                if (!Array.isArray(smInputs)) continue;
                const input = smInputs.find((candidate) => candidate.name === name);
                if (input) {
                    if (value === 'fire' && typeof input.fire === 'function') {
                        input.fire();
                    } else {
                        input.value = value;
                    }
                    return { ok: true, name, value };
                }
            }
            throw new Error(`Input "${name}" not found in any state machine`);
        },
    };
}
