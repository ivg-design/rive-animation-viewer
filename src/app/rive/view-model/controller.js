import {
    controlSnapshotKeyForDescriptor,
    getGlobalViewModelInstances,
    resolveVmRootInstance,
} from './accessors.js';
import { createVmControlAccessorResolver } from './controller/accessor-resolver.js';
import { buildStateMachineHierarchy, buildVmHierarchy, buildVmListTopologySignature, countAllInputs, stripNestedRootVmInputs } from './hierarchy.js';
import { createRemoteControlsAdapter } from './remote/controls.js';
import { attachRemoteControlListeners } from './remote/events.js';
import { createVmRemoteEventHandlers } from './remote/handlers.js';
import { createRemoteInteractionGate } from './remote/interaction-gate.js';
import { createVmControlRowFactory, createVmSectionElementFactory } from './ui-render.js';
import { resetVmInputControls, syncVmBindings } from './ui/binding-sync.js';
import { createVmSnapshotController } from './snapshot.js';
import { createVmSyncCoordinator } from './sync-coordinator.js';
import { getVmDepthColor } from './ui/depth-color.js';
import { createVmDisclosureState } from './ui/disclosure-state.js';
export function createVmControlsController({
    callbacks = {},
    documentRef = globalThis.document,
    elements,
    getEmbeddedImageAssets = () => [],
    getCurrentRuntime = () => 'webgl2',
    getLoadedRuntime = () => null,
    getRiveInstance = () => null,
    getRenderSurfaceAuthority = () => ({ canAcceptCommands: true }),
    getRenderSurfaceCanonicalState = () => null,
    isAuthoritativeChildMode = false,
    pickImageFile = null,
    clearIntervalFn = globalThis.clearInterval,
    scheduleReactiveFlush,
    setIntervalFn = globalThis.setInterval,
    syncMode = 'auto',
} = {}) {
    const { initLucideIcons = () => {}, logEvent = () => {}, showError = () => {} } = callbacks;
    let vmControlBindings = [];
    let vmListAccessors = [];
    let vmListTopologySignature = null;
    let isRenderingVmControls = false;
    let vmControlRenderEpoch = 0;
    let remoteAuthority = null;
    const remoteControls = createRemoteControlsAdapter({
        getCanonicalState: getRenderSurfaceCanonicalState,
    });
    const vmDisclosureState = createVmDisclosureState({
        getRemoteSessionId: () => remoteControls.getRevision().sessionId,
        isAuthoritativeChildMode,
    });
    function remoteTopologySignature() {
        const revision = remoteControls.getRevision();
        return `remote:${revision.sessionId || 'legacy'}:${revision.topology}`;
    }
    function canMutateRemoteControls() {
        if (!isAuthoritativeChildMode) return true;
        const authority = remoteAuthority || getRenderSurfaceAuthority?.() || null;
        return authority?.canAcceptCommands === true;
    }
    function clearVmControlBindings() {
        vmControlBindings.forEach((binding) => binding.dispose?.());
        vmControlBindings = [];
    }
    function registerVmControlBinding(descriptor, binding) {
        if (!descriptor || !binding) {
            return;
        }
        const registeredBinding = {
            descriptor: { ...descriptor },
            ...binding,
            accessor: binding.accessor || resolveControlAccessor(descriptor),
        };
        vmControlBindings.push(registeredBinding);
        remoteInteractionGate.registerBinding(registeredBinding);
    }
    const {
        fireStateMachineTriggerByName,
        resolveControlAccessor,
        resolveVmAccessor,
    } = createVmControlAccessorResolver({
        getCurrentRuntime,
        getLoadedRuntime,
        getRiveInstance,
        isAuthoritativeChildMode,
        remoteControls,
    });
    function syncVmControlBindings(force = false) {
        if (!vmControlBindings.length) {
            return;
        }
        const visibleBindings = force
            ? vmControlBindings
            : vmSyncCoordinator.filterVisibleBindings(vmControlBindings);
        syncVmBindings(
            visibleBindings,
            resolveControlAccessor,
            documentRef,
            force,
            () => getLoadedRuntime(getCurrentRuntime()),
            () => canMutateRemoteControls(),
        );
    }
    function currentVmListTopologySignature() {
        const riveInstance = getRiveInstance();
        const rootSignature = buildVmListTopologySignature(resolveVmRootInstance(riveInstance), riveInstance);
        const globalSignatures = getGlobalViewModelInstances(riveInstance)
            .map(({ instance, name }) => [name, buildVmListTopologySignature(instance, riveInstance)]);
        if (rootSignature === null && !globalSignatures.length) {
            return null;
        }
        return JSON.stringify({ globalSignatures, rootSignature });
    }
    function buildGlobalVmHierarchies(onListAccessor = () => {}) {
        return getGlobalViewModelInstances(getRiveInstance()).map(({ instance, name }) => {
            const descriptorScope = {
                globalViewModelName: name,
                source: 'global-view-model',
            };
            return instance
                ? buildVmHierarchy(instance, getRiveInstance(), {
                    descriptorScope,
                    onListAccessor,
                    rootLabel: name,
                })
                : {
                    ...descriptorScope,
                    children: [],
                    inputs: [],
                    kind: 'global-view-model',
                    label: name,
                    path: `global/${encodeURIComponent(name)}`,
                    totalInputs: 0,
                };
        });
    }
    const currentStateMachineHierarchy = () => buildStateMachineHierarchy(
        getRiveInstance(),
        getLoadedRuntime(getCurrentRuntime()),
    );
    const createVmControlRow = createVmControlRowFactory({
        documentRef,
        fireStateMachineTriggerByName,
        getRiveInstance,
        getEmbeddedImageAssets,
        getLoadedRuntime: () => getLoadedRuntime(getCurrentRuntime()),
        getVmControlRenderEpoch: () => vmControlRenderEpoch,
        logEvent,
        isAuthoritativeChildMode,
        canMutateRemoteControls,
        onRemoteMutationFailure: (message) => {
            syncVmControlBindings(true);
            showError(message);
        },
        pickImageFile,
        registerVmControlBinding,
        resolveControlAccessor,
        resolveVmAccessor,
    });
    const createVmSectionElement = createVmSectionElementFactory({
        createVmControlRow,
        documentRef,
        getDepthColor: getVmDepthColor,
        getSectionDisclosureKey: vmDisclosureState.keyForNode,
        getSectionOpenState: vmDisclosureState.openState,
    });
    const snapshotController = createVmSnapshotController({
        buildGlobalVmHierarchies,
        buildStateMachineHierarchy: currentStateMachineHierarchy,
        getBindings: () => vmControlBindings,
        getRiveInstance,
        resolveControlAccessor,
        syncVmControlBindings,
    });
    function resetControls(message = 'No bound ViewModel inputs detected.') {
        vmControlRenderEpoch += 1;
        if (isAuthoritativeChildMode && remoteControls.getHierarchy()) {
            renderVmInputControls();
            return;
        }
        vmSyncCoordinator.reset();
        resetVmInputControls(elements, message);
        clearVmControlBindings();
        vmListAccessors = [];
        vmListTopologySignature = null;
        vmDisclosureState.clear();
        snapshotController.clearPendingVmControlSnapshot();
        snapshotController.setVmControlBaselineSnapshot([]);
    }
    function renderVmInputControls() {
        if (isRenderingVmControls) {
            return;
        }

        const count = elements.vmControlsCount;
        const empty = elements.vmControlsEmpty;
        const tree = elements.vmControlsTree;
        if (!count || !empty || !tree) {
            return;
        }
        isRenderingVmControls = true;
        vmControlRenderEpoch += 1;
        try {
            vmSyncCoordinator.stopReactive();
            if (isAuthoritativeChildMode) {
                vmSyncCoordinator.reset();
                const hierarchy = remoteControls.getHierarchy();
                vmDisclosureState.prepare(tree, { hierarchy });
                tree.innerHTML = '';
                clearVmControlBindings();
                vmListAccessors = [];
                vmListTopologySignature = remoteTopologySignature();
                const totalControls = hierarchy ? countAllInputs(hierarchy) : 0;
                count.textContent = String(totalControls);
                vmSyncCoordinator.ensureUiListeners();
                if (!totalControls) {
                    empty.hidden = false;
                    empty.textContent = hierarchy
                        ? 'No writable ViewModel or state machine inputs were found.'
                        : 'Preparing playback controls…';
                    return;
                }
                empty.hidden = true;
                hierarchy.children.forEach((node, index) => {
                    const isFirstOrdinarySection = node.kind !== 'global-view-models'
                        && !hierarchy.children.slice(0, index).some((candidate) => candidate.kind !== 'global-view-models');
                    tree.appendChild(createVmSectionElement(node, isFirstOrdinarySection));
                });
                syncVmControlBindings(true);
                initLucideIcons();
                return;
            }

            const rootVm = resolveVmRootInstance(getRiveInstance());
            vmListTopologySignature = currentVmListTopologySignature();
            const nextVmListAccessors = [];
            const vmHierarchy = rootVm ? buildVmHierarchy(rootVm, getRiveInstance(), {
                onListAccessor: (entry) => nextVmListAccessors.push(entry),
            }) : null;
            const stateMachineHierarchy = currentStateMachineHierarchy();
            const globalVmHierarchies = buildGlobalVmHierarchies(
                (entry) => nextVmListAccessors.push(entry),
            );
            const globalVmGroup = globalVmHierarchies.length
                ? {
                    children: globalVmHierarchies,
                    inputs: [],
                    kind: 'global-view-models',
                    label: 'Global ViewModels',
                    path: '__global_view_models__',
                }
                : null;
            vmDisclosureState.prepare(tree, {
                hierarchy: [globalVmGroup, vmHierarchy, stateMachineHierarchy],
                source: getRiveInstance(),
            });
            tree.innerHTML = '';
            clearVmControlBindings();
            vmListAccessors = nextVmListAccessors;
            const vmTotal = vmHierarchy?.totalInputs || 0;
            const globalVmTotal = globalVmHierarchies.reduce(
                (total, hierarchy) => total + hierarchy.totalInputs,
                0,
            );
            const stateMachineTotal = stateMachineHierarchy?.totalInputs || 0;
            const totalControls = vmTotal + globalVmTotal + stateMachineTotal;
            count.textContent = String(totalControls);
            vmSyncCoordinator.ensureUiListeners();
            if (!totalControls && !globalVmGroup) {
                empty.hidden = false;
                empty.textContent = 'No writable ViewModel or state machine inputs were found.';
                if (vmListTopologySignature === null) {
                    vmSyncCoordinator.stopPolling();
                } else {
                    vmSyncCoordinator.refresh();
                }
                return;
            }

            empty.hidden = totalControls > 0;
            if (!totalControls) {
                empty.textContent = 'No writable global ViewModel inputs were found.';
            }
            if (globalVmGroup) {
                tree.appendChild(createVmSectionElement(globalVmGroup, false));
            }
            if (vmHierarchy) {
                tree.appendChild(createVmSectionElement(stripNestedRootVmInputs(vmHierarchy), true));
            }
            if (stateMachineHierarchy?.totalInputs) {
                stateMachineHierarchy.children.forEach((stateMachineNode) => {
                    tree.appendChild(createVmSectionElement(stateMachineNode, false));
                });
            }

            syncVmControlBindings(true);
            vmSyncCoordinator.refresh();
            initLucideIcons();
        } finally {
            isRenderingVmControls = false;
        }
    }
    const remoteInteractionGate = createRemoteInteractionGate({
        getBindings: () => vmControlBindings,
        renderTopology: renderVmInputControls,
    });
    function syncVmControlTopology(force = false) {
        if (isAuthoritativeChildMode) {
            const nextSignature = remoteTopologySignature();
            if (!force && nextSignature === vmListTopologySignature) return false;
            renderVmInputControls();
            return true;
        }
        const nextSignature = currentVmListTopologySignature();
        if (!force && nextSignature === vmListTopologySignature) {
            return false;
        }
        renderVmInputControls();
        snapshotController.retryPendingVmControlSnapshot();
        snapshotController.reconcileVmControlBaselineSnapshot();
        const EventConstructor = documentRef?.defaultView?.CustomEvent;
        if (EventConstructor) {
            documentRef.dispatchEvent(new EventConstructor('rav:vm-topology-changed'));
        }
        return true;
    }
    const vmSyncCoordinator = createVmSyncCoordinator({
        clearIntervalFn,
        documentRef,
        elements,
        getBindings: () => vmControlBindings,
        getListAccessors: () => vmListAccessors,
        getLoadedRuntime: () => getLoadedRuntime(getCurrentRuntime()),
        hasListTopology: () => vmListTopologySignature !== null,
        resolveControlAccessor,
        scheduleReactiveFlush,
        setIntervalFn,
        syncAllBindings: syncVmControlBindings,
        syncMode,
        syncTopology: syncVmControlTopology,
    });

    const { handleRemoteAuthorityChange, handleRemoteCanonicalState, handleRemoteCommandResult } = createVmRemoteEventHandlers({
        getCurrentTopologySignature: remoteTopologySignature,
        getTopologySignature: () => vmListTopologySignature,
        isAuthoritativeChildMode,
        remoteControls,
        renderVmInputControls: remoteInteractionGate.renderTopologyWhenSafe,
        setRemoteAuthority: (authority) => { remoteAuthority = authority; },
        showError,
        syncVmControlBindings,
    });
    const detachRemoteControlListeners = isAuthoritativeChildMode
        ? attachRemoteControlListeners(documentRef, {
            onAuthorityChange: handleRemoteAuthorityChange,
            onCanonicalState: handleRemoteCanonicalState,
            onCommandResult: handleRemoteCommandResult,
        })
        : () => {};

    function stopVmControlSync() {
        vmSyncCoordinator.stopPolling();
        vmSyncCoordinator.stopReactive();
        detachRemoteControlListeners();
    }
    return {
        applyVmControlSnapshot: snapshotController.applyVmControlSnapshot,
        captureVmControlSnapshot: snapshotController.captureVmControlSnapshot,
        controlSnapshotKeyForDescriptor,
        getChangedVmControlSnapshot: snapshotController.getChangedVmControlSnapshot,
        getVmSyncDiagnostics: () => (isAuthoritativeChildMode
            ? {
                mode: 'child-authoritative',
                stateRevision: remoteControls.getRevision().state,
                timerActive: false,
                topologyRevision: remoteControls.getRevision().topology,
                topologyStrategy: 'event',
                valueStrategy: 'event',
            }
            : vmSyncCoordinator.getDiagnostics()),
        renderVmInputControls,
        resetVmInputControls: resetControls,
        serializeControlHierarchy: snapshotController.serializeControlHierarchy,
        serializeVmHierarchy: snapshotController.serializeVmHierarchy,
        setVmControlBaselineSnapshot: snapshotController.setVmControlBaselineSnapshot,
        stopVmControlSync,
        syncVmControlBindings,
        syncVmControlTopology,
    };
}
