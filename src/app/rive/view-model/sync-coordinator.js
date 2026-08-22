import {
    VM_CONTROL_SYNC_INTERVAL_MS,
    VM_TOPOLOGY_SYNC_INTERVAL_MS,
} from '../../core/constants.js';
import { createReactiveVmSubscriptionSession } from './reactive-subscriptions.js';
import { syncVmBindings } from './ui/binding-sync.js';

const REACTIVE_VALUE_KINDS = new Set(['boolean', 'color', 'enum', 'number', 'string']);

function scheduleVmUiFlush(callback) {
    const timeoutId = globalThis.setTimeout(callback, VM_CONTROL_SYNC_INTERVAL_MS);
    return () => globalThis.clearTimeout(timeoutId);
}

function bindingElement(binding) {
    return binding.input
        || binding.colorInput
        || binding.button
        || binding.assetSelect
        || binding.clearButton
        || binding.browseButton;
}

export function createVmSyncCoordinator({
    clearIntervalFn = globalThis.clearInterval,
    documentRef = globalThis.document,
    elements,
    getBindings = () => [],
    getListAccessors = () => [],
    getLoadedRuntime = () => null,
    hasListTopology = () => false,
    resolveControlAccessor = () => null,
    scheduleReactiveFlush = scheduleVmUiFlush,
    setIntervalFn = globalThis.setInterval,
    syncAllBindings = () => {},
    syncMode = 'auto',
    syncTopology = () => false,
} = {}) {
    let fallbackBindings = [];
    let fallbackTopology = false;
    let pollingTimer = null;
    let reactiveSession = null;
    let reactiveStats = null;
    let reactiveBindingsByAccessor = new Map();
    const deferredBindings = new Set();
    let topologyElapsedMs = 0;
    let topologyDirty = false;
    let valuesDirty = false;
    let visibilityObserver = null;
    let documentVisibilityListenerAttached = false;
    let treeUiListenersAttached = false;

    function areControlsVisible() {
        if (documentRef?.visibilityState === 'hidden') {
            return false;
        }
        return !elements.mainGrid?.classList.contains('right-hidden');
    }

    function filterVisibleBindings(bindings = getBindings()) {
        if (!areControlsVisible()) {
            return [];
        }
        return bindings.filter((binding) => (
            !bindingElement(binding)?.closest?.('details.vm-section:not([open])')
        ));
    }

    function stopPolling() {
        if (pollingTimer) {
            clearIntervalFn(pollingTimer);
            pollingTimer = null;
        }
        topologyElapsedMs = 0;
    }

    function stopReactive() {
        if (reactiveSession) {
            reactiveSession.cleanup();
            reactiveStats = reactiveSession.getCapabilityStats();
            reactiveSession = null;
        }
        fallbackBindings = [];
        fallbackTopology = false;
        reactiveBindingsByAccessor = new Map();
    }

    function syncBindings(bindings, force = false) {
        syncVmBindings(
            bindings,
            resolveControlAccessor,
            documentRef,
            force,
            getLoadedRuntime,
        );
    }

    function isBindingEditing(binding) {
        const activeElement = documentRef?.activeElement;
        if (binding.kind === 'number' || binding.kind === 'string') {
            return activeElement === binding.input;
        }
        if (binding.kind === 'color') {
            return activeElement === binding.colorInput || activeElement === binding.alphaInput;
        }
        return false;
    }

    function syncBindingsWithEventValues(bindings, valueOverrides) {
        const eventValueBindings = bindings.map((binding) => (
            valueOverrides.has(binding.accessor)
                ? { ...binding, accessor: { value: valueOverrides.get(binding.accessor) } }
                : binding
        ));
        syncBindings(eventValueBindings);
    }

    function syncInvalidatedBindings(invalidations) {
        if (!areControlsVisible()) {
            valuesDirty = true;
            return;
        }
        valuesDirty = false;
        const candidates = new Set();
        const valueOverrides = new Map();
        invalidations.forEach((entry) => {
            const accessorBindings = reactiveBindingsByAccessor.get(entry.accessor) || [];
            accessorBindings.forEach((binding) => candidates.add(binding));
            if (entry.hasValue) {
                valueOverrides.set(entry.accessor, entry.value);
            }
        });
        const bindings = filterVisibleBindings([...candidates]);
        const readyBindings = bindings.filter((binding) => {
            if (isBindingEditing(binding)) {
                deferredBindings.add(binding);
                return false;
            }
            deferredBindings.delete(binding);
            return true;
        });
        if (readyBindings.length) {
            syncBindingsWithEventValues(readyBindings, valueOverrides);
        }
    }

    function flushDeferredBindings() {
        if (!deferredBindings.size) {
            return;
        }
        if (!areControlsVisible()) {
            valuesDirty = true;
            return;
        }
        const currentBindings = new Set(getBindings());
        const readyBindings = filterVisibleBindings([...deferredBindings]).filter((binding) => (
            currentBindings.has(binding) && !isBindingEditing(binding)
        ));
        readyBindings.forEach((binding) => deferredBindings.delete(binding));
        [...deferredBindings].forEach((binding) => {
            if (!currentBindings.has(binding)) {
                deferredBindings.delete(binding);
            }
        });
        if (readyBindings.length) {
            syncBindings(readyBindings);
        }
    }

    function handleListInvalidation() {
        if (!areControlsVisible()) {
            topologyDirty = true;
            return;
        }
        topologyDirty = false;
        syncTopology(true);
    }

    function startPolling() {
        if (pollingTimer || (!fallbackBindings.length && !fallbackTopology)) {
            return;
        }
        pollingTimer = setIntervalFn(() => {
            if (!areControlsVisible()) {
                return;
            }
            if (fallbackTopology) {
                topologyElapsedMs += VM_CONTROL_SYNC_INTERVAL_MS;
            }
            if (fallbackTopology && topologyElapsedMs >= VM_TOPOLOGY_SYNC_INTERVAL_MS) {
                topologyElapsedMs = 0;
                if (syncTopology()) {
                    return;
                }
            }
            if (fallbackBindings.length) {
                syncBindings(filterVisibleBindings(fallbackBindings));
            }
        }, VM_CONTROL_SYNC_INTERVAL_MS);
    }

    function finishRefresh() {
        if (fallbackBindings.length || fallbackTopology) {
            startPolling();
        } else {
            stopPolling();
        }
    }

    function refresh() {
        stopReactive();
        const bindings = getBindings();
        const bindingSet = new Set(bindings);
        [...deferredBindings].forEach((binding) => {
            if (!bindingSet.has(binding)) {
                deferredBindings.delete(binding);
            }
        });
        const visibleBindings = filterVisibleBindings(bindings)
            .filter((binding) => REACTIVE_VALUE_KINDS.has(binding.kind));
        const visibleBindingSet = new Set(visibleBindings);
        if (syncMode === 'polling') {
            fallbackBindings = bindings.filter((binding) => REACTIVE_VALUE_KINDS.has(binding.kind));
            fallbackTopology = hasListTopology();
            finishRefresh();
            return;
        }

        reactiveSession = createReactiveVmSubscriptionSession({
            onListInvalidated: handleListInvalidation,
            onValueInvalidated: syncInvalidatedBindings,
            schedule: scheduleReactiveFlush,
        });
        getListAccessors().forEach((entry) => {
            if (reactiveSession.subscribeList(entry).fallback) {
                fallbackTopology = true;
            }
        });

        // The default path deliberately keeps scalar values off the runtime's
        // per-frame callback graph. Lists remain reactive because their
        // topology changes are sparse and require an immediate tree rebuild;
        // scalar controls are reconciled at the existing 120 ms UI cadence.
        if (syncMode === 'auto') {
            fallbackBindings = bindings.filter((binding) => REACTIVE_VALUE_KINDS.has(binding.kind));
            finishRefresh();
            return;
        }

        bindings.forEach((binding) => {
            if (!REACTIVE_VALUE_KINDS.has(binding.kind)) {
                return;
            }
            if (!visibleBindingSet.has(binding)) {
                return;
            }
            const report = reactiveSession.subscribeProperty({
                accessor: binding.accessor,
                kind: binding.kind,
                path: binding.descriptor.path,
                propertyName: binding.descriptor.name,
            });
            if (report.fallback) {
                fallbackBindings.push(binding);
            } else {
                const accessorBindings = reactiveBindingsByAccessor.get(binding.accessor) || [];
                accessorBindings.push(binding);
                reactiveBindingsByAccessor.set(binding.accessor, accessorBindings);
            }
        });
        if (syncMode === 'reactive') {
            fallbackBindings = [];
            fallbackTopology = false;
        }
        finishRefresh();
    }

    function handleVisibilityChange() {
        if (!areControlsVisible()) {
            valuesDirty = true;
            deferredBindings.clear();
            refresh();
            return;
        }
        if (topologyDirty) {
            topologyDirty = false;
            syncTopology(true);
            return;
        }
        refresh();
        if (valuesDirty) {
            valuesDirty = false;
            syncAllBindings(true);
        }
    }

    function handleTreeToggle(event) {
        const opened = event.target?.matches?.('details.vm-section') && event.target.open;
        refresh();
        if (opened) {
            syncBindings(filterVisibleBindings());
        }
    }

    function handleTreeFocusOut() {
        const queue = documentRef?.defaultView?.queueMicrotask || globalThis.queueMicrotask;
        queue(flushDeferredBindings);
    }

    function ensureUiListeners() {
        const tree = elements.vmControlsTree;
        if (tree && !treeUiListenersAttached) {
            tree.addEventListener('focusout', handleTreeFocusOut, true);
            tree.addEventListener('toggle', handleTreeToggle, true);
            treeUiListenersAttached = true;
        }
        if (!documentVisibilityListenerAttached && typeof documentRef?.addEventListener === 'function') {
            documentRef.addEventListener('visibilitychange', handleVisibilityChange);
            documentVisibilityListenerAttached = true;
        }
        const MutationObserverCtor = documentRef?.defaultView?.MutationObserver;
        if (!visibilityObserver && elements.mainGrid && typeof MutationObserverCtor === 'function') {
            visibilityObserver = new MutationObserverCtor(handleVisibilityChange);
            visibilityObserver.observe(elements.mainGrid, {
                attributeFilter: ['class'],
                attributes: true,
            });
        }
    }

    function reset() {
        stopReactive();
        stopPolling();
        deferredBindings.clear();
        topologyDirty = false;
        valuesDirty = false;
    }

    function getDiagnostics() {
        const currentReactiveStats = reactiveSession?.getCapabilityStats() || null;
        const hasReactiveValues = Boolean(currentReactiveStats?.subscriptions?.value);
        let valueStrategy = 'none';
        if (syncMode === 'polling' || (!hasReactiveValues && fallbackBindings.length)) {
            valueStrategy = 'polling';
        } else if (hasReactiveValues && fallbackBindings.length) {
            valueStrategy = 'hybrid';
        } else if (hasReactiveValues || syncMode === 'reactive') {
            valueStrategy = 'reactive';
        }
        return {
            fallbackBindingCount: fallbackBindings.length,
            fallbackTopology,
            mode: syncMode,
            reactive: currentReactiveStats || reactiveStats,
            timerActive: Boolean(pollingTimer),
            topologyStrategy: fallbackTopology
                ? 'polling'
                : (currentReactiveStats?.subscriptions?.list ? 'reactive' : 'none'),
            valueStrategy,
        };
    }

    return {
        ensureUiListeners,
        filterVisibleBindings,
        getDiagnostics,
        refresh,
        reset,
        stopPolling,
        stopReactive,
    };
}
