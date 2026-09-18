import {
    getVmAccessor,
    navigateToVmInstance,
    resolveGlobalViewModelInstance,
    resolveVmRootInstance,
} from '../accessors.js';
import { sourceScopesMatch } from '../../inspection/source-scope.js';

export function createVmControlAccessorResolver({
    getRiveInstance,
    isAuthoritativeChildMode,
    remoteControls,
    getCurrentSourceScope = null,
    getControlSourceScope = null,
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

    function resolveControlAccessor(descriptor) {
        if (getCurrentSourceScope && !sourceScopesMatch(getCurrentSourceScope(), getControlSourceScope?.())) return null;
        if (isAuthoritativeChildMode) return remoteControls.resolveAccessor(descriptor);
        return resolveVmAccessor(descriptor, descriptor.kind);
    }

    return {
        resolveControlAccessor,
        resolveVmAccessor,
    };
}
