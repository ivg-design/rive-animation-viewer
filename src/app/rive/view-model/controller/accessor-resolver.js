import {
    getStateMachineInputKind,
    getVmAccessor,
    navigateToVmInstance,
    resolveGlobalViewModelInstance,
    resolveVmRootInstance,
} from '../accessors.js';

export function createVmControlAccessorResolver({
    getCurrentRuntime,
    getLoadedRuntime,
    getRiveInstance,
    isAuthoritativeChildMode,
    remoteControls,
}) {
    function resolveVmAccessor(descriptor, expectedKind) {
        const normalizedDescriptor = typeof descriptor === 'string'
            ? { path: descriptor }
            : descriptor;
        const rootVm = normalizedDescriptor?.source === 'global-view-model'
            ? resolveGlobalViewModelInstance(getRiveInstance(), normalizedDescriptor.globalViewModelName)
            : resolveVmRootInstance(getRiveInstance());
        if (!rootVm) return null;

        const navigation = navigateToVmInstance(rootVm, normalizedDescriptor?.path);
        if (!navigation) return null;

        const accessorInfo = getVmAccessor(navigation.instance, navigation.propertyName);
        if (!accessorInfo || (expectedKind && accessorInfo.kind !== expectedKind)) return null;
        return accessorInfo.accessor;
    }

    function resolveStateMachineInputAccessor(stateMachineName, inputName, expectedKind) {
        const riveInstance = getRiveInstance();
        if (!riveInstance || typeof riveInstance.stateMachineInputs !== 'function' || !stateMachineName || !inputName) {
            return null;
        }
        try {
            const inputs = riveInstance.stateMachineInputs(stateMachineName);
            if (!Array.isArray(inputs)) return null;
            const input = inputs.find((candidate) => candidate?.name === inputName);
            if (!input) return null;
            const detectedKind = getStateMachineInputKind(input, getLoadedRuntime(getCurrentRuntime()));
            return !expectedKind || detectedKind === expectedKind ? input : null;
        } catch {
            return null;
        }
    }

    function resolveControlAccessor(descriptor) {
        if (isAuthoritativeChildMode) return remoteControls.resolveAccessor(descriptor);
        if (descriptor?.source === 'state-machine') {
            return resolveStateMachineInputAccessor(descriptor.stateMachineName, descriptor.name, descriptor.kind);
        }
        return resolveVmAccessor(descriptor, descriptor.kind);
    }

    function fireStateMachineTriggerByName(triggerName) {
        const riveInstance = getRiveInstance();
        if (!riveInstance || typeof riveInstance.stateMachineInputs !== 'function' || !triggerName) return 0;

        const stateMachineNames = Array.isArray(riveInstance.stateMachineNames) ? riveInstance.stateMachineNames : [];
        let firedCount = 0;
        stateMachineNames.forEach((stateMachineName) => {
            let inputs = [];
            try {
                const resolvedInputs = riveInstance.stateMachineInputs(stateMachineName);
                if (Array.isArray(resolvedInputs)) inputs = resolvedInputs;
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

    return {
        fireStateMachineTriggerByName,
        resolveControlAccessor,
        resolveStateMachineInputAccessor,
        resolveVmAccessor,
    };
}
