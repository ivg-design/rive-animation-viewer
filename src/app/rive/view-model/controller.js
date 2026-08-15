import {
    VM_CONTROL_SYNC_INTERVAL_MS,
} from '../../core/constants.js';
import {
    controlSnapshotKeyForDescriptor,
    getStateMachineInputKind,
    getVmAccessor,
    navigateToVmInstance,
    resolveVmRootInstance,
} from './accessors.js';
import {
    buildStateMachineHierarchy,
    buildVmHierarchy,
    buildVmListTopologySignature,
    stripNestedRootVmInputs,
} from './hierarchy.js';
import {
    createVmControlRowFactory,
    createVmSectionElementFactory,
    resetVmInputControls,
    syncVmBindings,
} from './ui-render.js';
import { createVmSnapshotController } from './snapshot.js';

const VM_DEPTH_COLORS = [
    '#C4F82A',
    '#38BDF8',
    '#A78BFA',
    '#FB923C',
    '#F472B6',
    '#34D399',
];

export function createVmControlsController({
    callbacks = {},
    documentRef = globalThis.document,
    elements,
    getEmbeddedImageAssets = () => [],
    getCurrentRuntime = () => 'webgl2',
    getLoadedRuntime = () => null,
    getRiveInstance = () => null,
    clearIntervalFn = globalThis.clearInterval,
    setIntervalFn = globalThis.setInterval,
} = {}) {
    const {
        initLucideIcons = () => {},
        logEvent = () => {},
    } = callbacks;

    let vmControlBindings = [];
    let vmControlSyncTimer = null;
    let vmListTopologySignature = null;
    let isRenderingVmControls = false;

    function getDepthColor(depth) {
        return VM_DEPTH_COLORS[depth % VM_DEPTH_COLORS.length];
    }

    function clearVmControlBindings() {
        vmControlBindings = [];
    }

    function registerVmControlBinding(descriptor, binding) {
        if (!descriptor || !binding) {
            return;
        }
        vmControlBindings.push({
            descriptor: { ...descriptor },
            ...binding,
        });
    }

    function resolveVmAccessor(path, expectedKind) {
        const rootVm = resolveVmRootInstance(getRiveInstance());
        if (!rootVm) {
            return null;
        }

        const navigation = navigateToVmInstance(rootVm, path);
        if (!navigation) {
            return null;
        }

        const accessorInfo = getVmAccessor(navigation.instance, navigation.propertyName);
        if (!accessorInfo) {
            return null;
        }
        if (expectedKind && accessorInfo.kind !== expectedKind) {
            return null;
        }
        return accessorInfo.accessor;
    }

    function resolveStateMachineInputAccessor(stateMachineName, inputName, expectedKind) {
        const riveInstance = getRiveInstance();
        if (!riveInstance || typeof riveInstance.stateMachineInputs !== 'function' || !stateMachineName || !inputName) {
            return null;
        }

        try {
            const inputs = riveInstance.stateMachineInputs(stateMachineName);
            if (!Array.isArray(inputs)) {
                return null;
            }

            const input = inputs.find((candidate) => candidate?.name === inputName);
            if (!input) {
                return null;
            }

            const runtime = getLoadedRuntime(getCurrentRuntime());
            const detectedKind = getStateMachineInputKind(input, runtime);
            if (expectedKind && detectedKind !== expectedKind) {
                return null;
            }

            return input;
        } catch {
            return null;
        }
    }

    function resolveControlAccessor(descriptor) {
        if (descriptor?.source === 'state-machine') {
            return resolveStateMachineInputAccessor(descriptor.stateMachineName, descriptor.name, descriptor.kind);
        }
        return resolveVmAccessor(descriptor.path, descriptor.kind);
    }

    function fireStateMachineTriggerByName(triggerName) {
        const riveInstance = getRiveInstance();
        if (!riveInstance || typeof riveInstance.stateMachineInputs !== 'function' || !triggerName) {
            return 0;
        }

        const stateMachineNames = Array.isArray(riveInstance.stateMachineNames) ? riveInstance.stateMachineNames : [];
        let firedCount = 0;

        stateMachineNames.forEach((stateMachineName) => {
            let inputs = [];
            try {
                const resolvedInputs = riveInstance.stateMachineInputs(stateMachineName);
                if (Array.isArray(resolvedInputs)) {
                    inputs = resolvedInputs;
                }
            } catch {
                inputs = [];
            }

            inputs.forEach((input) => {
                const runtime = getLoadedRuntime(getCurrentRuntime());
                if (!input || input.name !== triggerName || getStateMachineInputKind(input, runtime) !== 'trigger' || typeof input.fire !== 'function') {
                    return;
                }

                try {
                    input.fire();
                    firedCount += 1;
                } catch {
                    /* noop */
                }
            });
        });

        return firedCount;
    }

    function syncVmControlBindings(force = false) {
        if (!vmControlBindings.length) {
            return;
        }
        syncVmBindings(vmControlBindings, resolveControlAccessor, documentRef, force, () => getLoadedRuntime(getCurrentRuntime()));
    }

    function currentVmListTopologySignature() {
        return buildVmListTopologySignature(resolveVmRootInstance(getRiveInstance()), getRiveInstance());
    }

    function stopVmControlSync() {
        if (vmControlSyncTimer) {
            clearIntervalFn(vmControlSyncTimer);
            vmControlSyncTimer = null;
        }
    }

    function startVmControlSync() {
        if (vmControlSyncTimer || (!vmControlBindings.length && vmListTopologySignature === null)) {
            return;
        }
        vmControlSyncTimer = setIntervalFn(() => {
            if (!syncVmControlTopology()) {
                syncVmControlBindings(false);
            }
        }, VM_CONTROL_SYNC_INTERVAL_MS);
    }

    function currentStateMachineHierarchy() {
        return buildStateMachineHierarchy(getRiveInstance(), getLoadedRuntime(getCurrentRuntime()));
    }

    const createVmControlRow = createVmControlRowFactory({
        documentRef,
        fireStateMachineTriggerByName,
        getRiveInstance,
        getEmbeddedImageAssets,
        getLoadedRuntime: () => getLoadedRuntime(getCurrentRuntime()),
        logEvent,
        registerVmControlBinding,
        resolveControlAccessor,
        resolveVmAccessor,
    });
    const createVmSectionElement = createVmSectionElementFactory({
        createVmControlRow,
        documentRef,
        getDepthColor,
    });

    const snapshotController = createVmSnapshotController({
        buildStateMachineHierarchy: currentStateMachineHierarchy,
        getBindings: () => vmControlBindings,
        getRiveInstance,
        resolveControlAccessor,
        syncVmControlBindings,
    });

    function resetControls(message = 'No bound ViewModel inputs detected.') {
        resetVmInputControls(elements, message);
        clearVmControlBindings();
        stopVmControlSync();
        vmListTopologySignature = null;
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
        try {
            tree.innerHTML = '';
            clearVmControlBindings();

            const rootVm = resolveVmRootInstance(getRiveInstance());
            vmListTopologySignature = buildVmListTopologySignature(rootVm, getRiveInstance());
            const vmHierarchy = rootVm ? buildVmHierarchy(rootVm, getRiveInstance()) : null;
            const stateMachineHierarchy = currentStateMachineHierarchy();

            const vmTotal = vmHierarchy?.totalInputs || 0;
            const stateMachineTotal = stateMachineHierarchy?.totalInputs || 0;
            const totalControls = vmTotal + stateMachineTotal;
            count.textContent = String(totalControls);

            if (!totalControls) {
                empty.hidden = false;
                empty.textContent = 'No writable ViewModel or state machine inputs were found.';
                if (vmListTopologySignature === null) {
                    stopVmControlSync();
                } else {
                    startVmControlSync();
                }
                return;
            }

            empty.hidden = true;

            if (vmHierarchy) {
                tree.appendChild(createVmSectionElement(stripNestedRootVmInputs(vmHierarchy), true));
            }

            if (stateMachineHierarchy?.totalInputs) {
                stateMachineHierarchy.children.forEach((stateMachineNode) => {
                    tree.appendChild(createVmSectionElement(stateMachineNode, false));
                });
            }

            startVmControlSync();
            syncVmControlBindings(true);
            initLucideIcons();
        } finally {
            isRenderingVmControls = false;
        }
    }

    function syncVmControlTopology() {
        const nextSignature = currentVmListTopologySignature();
        if (nextSignature === vmListTopologySignature) {
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

    return {
        applyVmControlSnapshot: snapshotController.applyVmControlSnapshot,
        captureVmControlSnapshot: snapshotController.captureVmControlSnapshot,
        controlSnapshotKeyForDescriptor,
        getChangedVmControlSnapshot: snapshotController.getChangedVmControlSnapshot,
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
