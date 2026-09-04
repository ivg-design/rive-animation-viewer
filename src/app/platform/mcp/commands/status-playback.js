import { dispatchVmControlMutation } from '../../../rive/control-events.js';
import { buildPlaybackResetContract } from '../../../rive/reset-contract.js';
import { parsePlaybackTarget } from '../../../rive/artboards/playback-target.js';
import { getInspectionMetadata, getStateMachineInputMetadata } from '../../../rive/runtime-compatibility.js';
import { createMcpOpenFileCommand } from './open-file.js';
import { assertKnownPlaybackTarget } from './playback-validation.js';
import {
    assertAuthoritativeRenderSurface,
    canonicalControlSnapshot,
    canonicalInputs,
    countCanonicalInputs,
    findCanonicalInput,
    getAuthoritativeRenderSurface,
    requestAuthoritativeCommand,
} from '../authoritative.js';
export function createStatusPlaybackCommands({
    buildViewModelSnapshot,
    documentRef = globalThis.document,
    getCanvasBackgroundStateSnapshot,
    getRenderSurfaceController,
    renderSurfaceController,
    windowRef = globalThis.window,
} = {}) {
    const ravOpenFile = createMcpOpenFileCommand(windowRef);
    function getController() {
        if (typeof getRenderSurfaceController === 'function') return getRenderSurfaceController();
        if (typeof renderSurfaceController === 'function') return renderSurfaceController();
        if (renderSurfaceController) return renderSurfaceController;
        if (typeof windowRef?._mcpGetRenderSurfaceController === 'function') {
            return windowRef._mcpGetRenderSurfaceController();
        }
        return windowRef?._mcpRenderSurfaceController || null;
    }
    function getAuthoritative() {
        return assertAuthoritativeRenderSurface({ getRenderSurfaceController, renderSurfaceController, windowRef });
    }
    function buildSafeArtboardState(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return null;
        return {
            currentArtboard: snapshot.currentArtboard || null,
            currentPlaybackName: snapshot.currentPlaybackName || null,
            currentPlaybackType: snapshot.currentPlaybackType || null,
            defaultArtboard: snapshot.defaultArtboard || null,
            defaultPlaybackKey: snapshot.defaultPlaybackKey || null,
        };
    }
    function buildSafeRenderSurfaceState(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return null;
        const hasActiveSessionId = Object.hasOwn(snapshot, 'activeSessionId');
        const hasStagedSessionId = Object.hasOwn(snapshot, 'stagedSessionId')
            || (Object.hasOwn(snapshot, 'activeSessionId') && Object.hasOwn(snapshot, 'sessionId'));
        const active = Boolean(
            (snapshot.activeSessionId || (!hasActiveSessionId && snapshot.surfaceCreated))
            && snapshot.isLoaded,
        );
        return {
            active,
            isLoaded: Boolean(snapshot.isLoaded),
            pendingCommands: Number.isFinite(snapshot.pendingCommands) ? snapshot.pendingCommands : 0,
            sessionId: snapshot.activeSessionId || snapshot.sessionId || null,
            surfaceCreated: Boolean(snapshot.surfaceCreated),
            ...(hasActiveSessionId ? { activeSessionId: snapshot.activeSessionId || null } : {}),
            ...(hasStagedSessionId ? { stagedSessionId: snapshot.stagedSessionId || snapshot.sessionId || null } : {}),
            ...(Object.hasOwn(snapshot, 'activatingSessionId')
                ? { activatingSessionId: snapshot.activatingSessionId || null }
                : {}),
            ...(Object.hasOwn(snapshot, 'stagedReady') ? { stagedReady: Boolean(snapshot.stagedReady) } : {}),
            ...(Object.hasOwn(snapshot, 'activeSessionId')
                ? { health: active ? 'active' : (snapshot.sessionId ? 'staged' : 'unavailable') }
                : {}),
        };
    }
    return {
        async rav_status() {
            const controller = getController();
            const authoritative = getAuthoritativeRenderSurface({ getRenderSurfaceController, renderSurfaceController, windowRef });
            const buildInfo = windowRef.__RAV_BUILD_INFO__ || {};
            const inst = windowRef.riveInst;
            const controllerState = controller?.getState?.() || windowRef._mcpGetRenderSurfaceState?.();
            const controllerPresent = Boolean(controller);
            const availableInstanceKeys = authoritative?.canonicalState?.vmInstance?.availableKeys;
            const vmSnapshot = authoritative
                ? { paths: canonicalInputs(authoritative.canonicalState), hasRoot: Boolean(authoritative.canonicalState?.controlsHierarchy) }
                : controllerPresent
                    ? { paths: [], hasRoot: false }
                    : buildViewModelSnapshot(windowRef);
            const liveConfigState = windowRef._mcpGetLiveConfigState?.() || { draftDirty: false, sourceMode: 'internal' };
            const canonicalPlayback = authoritative?.canonicalState?.playback || {};
            const canvasBackgroundState = typeof getCanvasBackgroundStateSnapshot === 'function'
                ? getCanvasBackgroundStateSnapshot()
                : windowRef._mcpGetCanvasBackgroundState?.();
            const canvasColor = canvasBackgroundState?.canvasColor
                || documentRef.getElementById('canvas-color-input')?.value
                || '#0d1117';
            return {
                connected: true,
                app: { build: buildInfo.build || null, channel: buildInfo.channel || null, version: buildInfo.version || null },
                file: {
                    name: windowRef.__riveAnimationCache?.getName() || null,
                    loaded: authoritative ? true : controllerPresent ? Boolean(controllerState?.activeSessionId && controllerState?.isLoaded) : Boolean(inst),
                    sizeBytes: windowRef.__riveAnimationCache?.getBuffer()?.byteLength || 0,
                },
                runtime: {
                    name: documentRef.getElementById('runtime-select')?.value || 'unknown',
                    version: windowRef.__riveRuntimeCache?.getRuntimeVersion() || 'unknown',
                },
                playback: {
                    isPlaying: authoritative ? Boolean(canonicalPlayback.isPlaying) : controllerPresent ? false : (inst ? inst.isPlaying : false),
                    isPaused: authoritative ? Boolean(canonicalPlayback.isPaused ?? !canonicalPlayback.isPlaying) : controllerPresent ? true : (inst ? inst.isStopped || !inst.isPlaying : true),
                    ...(authoritative ? {
                        type: canonicalPlayback.type || null,
                        name: canonicalPlayback.name || null,
                        ...(canonicalPlayback.currentFrame !== undefined ? { currentFrame: canonicalPlayback.currentFrame } : {}),
                        ...(canonicalPlayback.currentSeconds !== undefined ? { currentSeconds: canonicalPlayback.currentSeconds } : {}),
                        ...(canonicalPlayback.durationSeconds !== undefined ? { durationSeconds: canonicalPlayback.durationSeconds } : {}),
                        ...(canonicalPlayback.fps !== undefined ? { fps: canonicalPlayback.fps } : {}),
                        ...(canonicalPlayback.totalFrames !== undefined ? { totalFrames: canonicalPlayback.totalFrames } : {}),
                        ...(canonicalPlayback.totalSeconds !== undefined ? { totalSeconds: canonicalPlayback.totalSeconds } : {}),
                    } : {}),
                },
                layout: {
                    fit: documentRef.getElementById('layout-select')?.value || 'contain',
                    alignment: documentRef.getElementById('alignment-select')?.value || 'center',
                    canvasColor: canvasBackgroundState?.canvasTransparent ? 'transparent' : canvasColor,
                    canvasTransparent: Boolean(canvasBackgroundState?.canvasTransparent),
                    canvasSize: windowRef._mcpGetCanvasSizing?.() || null,
                },
                viewModel: {
                    hasRoot: vmSnapshot.hasRoot,
                    pathCount: authoritative ? countCanonicalInputs(authoritative.canonicalState) : vmSnapshot.paths.length,
                    instanceKey: authoritative?.canonicalState?.vmInstance?.key ?? null,
                    availableInstanceKeys: Array.isArray(availableInstanceKeys) ? availableInstanceKeys.slice() : [],
                },
                instantiation: {
                    draftDirty: Boolean(liveConfigState.draftDirty),
                    sourceMode: liveConfigState.sourceMode || 'internal',
                },
                artboard: authoritative
                    ? buildSafeArtboardState({
                        currentArtboard: authoritative.canonicalState.artboard,
                        currentPlaybackName: canonicalPlayback.name,
                        currentPlaybackType: canonicalPlayback.type,
                    })
                    : controllerPresent ? null : buildSafeArtboardState(windowRef._mcpGetArtboardState?.()) || null,
                renderSurface: authoritative
                    ? buildSafeRenderSurfaceState({ ...authoritative.state, isLoaded: true })
                    : buildSafeRenderSurfaceState(controllerState),
            };
        },
        async rav_switch_artboard({ artboard, playback }) {
            if (!artboard) throw new Error('artboard is required');
            const requestedPlayback = playback ? parsePlaybackTarget(playback) : null;
            const authoritative = getAuthoritative();
            assertKnownPlaybackTarget({ artboardName: artboard, authoritative, requestedPlayback, windowRef });
            if (authoritative) {
                if (typeof windowRef._mcpSwitchArtboard !== 'function') throw new Error('Artboard switcher not available');
                await windowRef._mcpSwitchArtboard(artboard, playback || null);
                const canonicalState = authoritative.controller.getCanonicalState?.() || null;
                const playbackApplied = !requestedPlayback?.name
                    || (canonicalState?.playback?.name === requestedPlayback.name
                        && canonicalState?.playback?.type === requestedPlayback.type);
                const applied = canonicalState?.artboard === artboard && playbackApplied;
                return {
                    applied,
                    artboard: canonicalState?.artboard || null,
                    canonicalState,
                    playback: canonicalState?.playback || null,
                    status: applied ? 'applied' : 'rejected',
                };
            }
            if (typeof windowRef._mcpSwitchArtboard !== 'function') throw new Error('Artboard switcher not available');
            await windowRef._mcpSwitchArtboard(artboard, playback || null);
            return { ok: true, artboard, playback };
        },

        async rav_reset_artboard() {
            const authoritative = getAuthoritative();
            if (authoritative) {
                if (typeof windowRef._mcpResetArtboard !== 'function') throw new Error('Artboard switcher not available');
                const expectedArtboard = windowRef._mcpGetArtboardState?.()?.defaultArtboard || null;
                await windowRef._mcpResetArtboard();
                const canonicalState = authoritative.controller.getCanonicalState?.() || null;
                const applied = !expectedArtboard || canonicalState?.artboard === expectedArtboard;
                return {
                    applied,
                    canonicalState,
                    status: applied ? 'applied' : 'rejected',
                };
            }
            if (typeof windowRef._mcpResetArtboard !== 'function') throw new Error('Artboard switcher not available');
            await windowRef._mcpResetArtboard();
            return { ok: true };
        },
        async rav_set_anonymous_usage({ enabled }) {
            if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean');
            if (typeof windowRef._mcpSetInstallCounterEnabled !== 'function') {
                throw new Error('Anonymous usage control not available');
            }
            const applied = await windowRef._mcpSetInstallCounterEnabled(enabled);
            return { applied: applied === true, enabled, status: applied === true ? 'applied' : 'rejected' };
        },
        rav_open_file: ravOpenFile,

        async rav_play() {
            const authoritative = getAuthoritative();
            if (authoritative) {
                const playback = authoritative.canonicalState?.playback || {};
                return requestAuthoritativeCommand(authoritative, 'play', playback.name ? { name: playback.name } : {});
            }
            if (typeof windowRef.play === 'function') {
                await windowRef.play();
                return { ok: true };
            }
            throw new Error('No play function available');
        },

        async rav_pause() {
            const authoritative = getAuthoritative();
            if (authoritative) return requestAuthoritativeCommand(authoritative, 'pause');
            if (typeof windowRef.pause === 'function') {
                await windowRef.pause();
                return { ok: true };
            }
            throw new Error('No pause function available');
        },

        async rav_reset() {
            const authoritative = getAuthoritative();
            if (authoritative) {
                const playback = authoritative.canonicalState?.playback || {};
                return requestAuthoritativeCommand(authoritative, 'reset', {
                    params: buildPlaybackResetContract({
                        artboard: authoritative.canonicalState?.artboard,
                        playbackName: playback.name,
                        playbackType: playback.type,
                        viewModelInstanceKey: authoritative.canonicalState?.vmInstance?.key,
                    }),
                    snapshot: canonicalControlSnapshot(authoritative.canonicalState),
                });
            }
            if (typeof windowRef.reset === 'function') {
                await windowRef.reset();
                return { ok: true };
            }
            throw new Error('No reset function available');
        },

        async rav_get_artboards() {
            const authoritative = getAuthoritative();
            if (authoritative) {
                const names = Array.isArray(authoritative.canonicalState?.artboards)
                    ? authoritative.canonicalState.artboards
                    : (authoritative.canonicalState?.artboard ? [authoritative.canonicalState.artboard] : []);
                return { artboards: names.map((entry) => typeof entry === 'string' ? { name: entry } : entry) };
            }
            const inst = windowRef.riveInst;
            if (!inst) throw new Error('No animation loaded');
            const contents = getInspectionMetadata(inst);
            if (contents?.artboards) {
                return {
                    artboards: contents.artboards.map((artboard) => (
                        typeof artboard === 'string' ? { name: artboard } : artboard
                    )),
                };
            }
            return { artboards: [], metadataAvailable: false };
        },

        async rav_get_state_machines() {
            const authoritative = getAuthoritative();
            if (authoritative) {
                const names = Array.isArray(authoritative.canonicalState?.stateMachines)
                    ? authoritative.canonicalState.stateMachines
                    : (authoritative.canonicalState?.playback?.type === 'stateMachine' && authoritative.canonicalState.playback.name
                        ? [authoritative.canonicalState.playback.name]
                        : []);
                return { stateMachines: names.map((entry) => typeof entry === 'string' ? entry : entry.name).filter(Boolean) };
            }
            const inst = windowRef.riveInst;
            if (!inst) throw new Error('No animation loaded');
            const names = inst.stateMachineNames;
            if (Array.isArray(names) && names.length > 0) {
                return { stateMachines: names };
            }
            const contents = getInspectionMetadata(inst);
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
            const authoritative = getAuthoritative();
            if (authoritative) {
                return {
                    inputs: canonicalInputs(authoritative.canonicalState)
                        .filter((input) => input.source === 'state-machine')
                        .map((input) => ({
                            stateMachine: input.stateMachineName,
                            name: input.name,
                            type: input.kind,
                            ...(input.value !== undefined ? { value: input.value } : {}),
                        })),
                };
            }
            const inst = windowRef.riveInst;
            if (!inst) throw new Error('No animation loaded');
            const inputs = [];
            try {
                const smNames = Array.isArray(inst.stateMachineNames) ? inst.stateMachineNames : [];
                for (const smName of smNames) {
                    if (typeof inst.stateMachineInputs !== 'function' || getStateMachineInputMetadata(inst, smName)?.length === 0) continue;
                    const smInputs = inst.stateMachineInputs(smName);
                    if (!Array.isArray(smInputs)) continue;
                    for (const input of smInputs) {
                        const entry = { stateMachine: smName, name: input.name, type: input.type };
                        if ('value' in input) entry.value = input.value;
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
            const authoritative = getAuthoritative();
            if (authoritative) {
                const input = canonicalInputs(authoritative.canonicalState)
                    .find((candidate) => candidate.source === 'state-machine' && candidate.name === name);
                if (!input) throw new Error(`Input "${name}" not found in visible render surface`);
                const isTrigger = value === 'fire' || input.kind === 'trigger';
                const result = await requestAuthoritativeCommand(authoritative, isTrigger ? 'sm-fire' : 'sm-set', {
                    descriptor: {
                        kind: isTrigger ? 'trigger' : input.kind,
                        name: input.name,
                        path: input.path,
                        source: 'state-machine',
                        stateMachineName: input.stateMachineName,
                    },
                    value: isTrigger ? undefined : value,
                });
                return {
                    ...result,
                    name,
                    value: isTrigger ? 'fire' : (findCanonicalInput(result.canonicalState, input.path)?.value ?? value),
                };
            }
            const inst = windowRef.riveInst;
            if (!inst) throw new Error('No animation loaded');
            const smNames = Array.isArray(inst.stateMachineNames) ? inst.stateMachineNames : [];
            for (const smName of smNames) {
                if (typeof inst.stateMachineInputs !== 'function' || getStateMachineInputMetadata(inst, smName)?.length === 0) continue;
                const smInputs = inst.stateMachineInputs(smName);
                if (!Array.isArray(smInputs)) continue;
                const input = smInputs.find((candidate) => candidate.name === name);
                if (input) {
                    if (value === 'fire' && typeof input.fire === 'function') {
                        input.fire();
                        dispatchVmControlMutation(documentRef, {
                            action: 'fire',
                            descriptor: {
                                kind: 'trigger',
                                name,
                                path: `${smName}/${name}`,
                                source: 'state-machine',
                                stateMachineName: smName,
                            },
                            kind: 'trigger',
                        });
                    } else {
                        input.value = value;
                        const kind = typeof value === 'boolean' ? 'boolean' : 'number';
                        dispatchVmControlMutation(documentRef, {
                            descriptor: {
                                kind,
                                name,
                                path: `${smName}/${name}`,
                                source: 'state-machine',
                                stateMachineName: smName,
                            },
                            kind,
                            value,
                        });
                    }
                    return { ok: true, name, value };
                }
            }
            throw new Error(`Input "${name}" not found in any state machine`);
        },
    };
}
