        function getCanonicalListLength(accessor) {
            if (!accessor) return 0;
            if (typeof accessor.length === 'number') return Math.max(0, Math.floor(accessor.length));
            if (typeof accessor.size === 'number') return Math.max(0, Math.floor(accessor.size));
            return 0;
        }

	        function getCanonicalListItems(accessor, length) {
            var items = [];
            for (var index = 0; index < length; index++) {
                var item = null;
                try { if (typeof accessor.instanceAt === 'function') item = accessor.instanceAt(index); } catch (e) { /* noop */ }
                items.push(item);
            }
	            return items;
	        }

	        function getRuntimeIdentityToken(value) {
	            if (!value || typeof value !== 'object') return null;
	            var nativeValue = value.runtimeInstance || value.nativeInstance
	                || value._runtimeInstance || value._viewModelInstanceValue || value;
	            var pointer = nativeValue && nativeValue.$$ && nativeValue.$$.ptr;
	            if (typeof pointer === 'number' || typeof pointer === 'bigint' || typeof pointer === 'string') {
	                return 'native:' + String(pointer);
	            }
	            return nativeValue === value ? null : nativeValue;
	        }

	        function runtimeIdentityChanged(previous, current) {
	            if (previous === current) return false;
	            var previousToken = getRuntimeIdentityToken(previous);
	            var currentToken = getRuntimeIdentityToken(current);
	            if (previousToken !== null || currentToken !== null) {
	                return previousToken !== currentToken;
	            }
	            return true;
	        }

        function cleanupRenderSurfaceTopologySubscriptions(bridgeState) {
            (bridgeState.topologyUnsubscribers || []).forEach(function (unsubscribe) {
                try { unsubscribe(); } catch (e) { /* noop */ }
            });
            bridgeState.topologyUnsubscribers = [];
        }

        function subscribeRenderSurfaceListTopology(accessor, bridgeState, tracker) {
            if (!accessor || typeof accessor.on !== 'function' || typeof accessor.off !== 'function') {
                tracker.requiresFallbackScan = true;
                return false;
            }
            var invalidate = function () {
                bridgeState.topologyDirty = true;
                // Never let the next onAdvance consume a list invalidation and
                // build a large hierarchy on the render-critical path.
                scheduleRenderSurfaceCanonicalRefresh('topology-list', true);
            };
            try {
                accessor.on(invalidate);
                bridgeState.topologyUnsubscribers.push(function () { accessor.off(invalidate); });
                return true;
            } catch (e) {
                tracker.requiresFallbackScan = true;
                try { accessor.off(invalidate); } catch (offError) { /* noop */ }
                return false;
            }
        }

        function captureTopologyTrackers(rootVm, bridgeState) {
            cleanupRenderSurfaceTopologySubscriptions(bridgeState);
            bridgeState.topologyDirty = false;
            var tracker = {
                fallbackItemCursor: 0,
                fallbackListCursor: 0,
                lists: [],
                nested: [],
                requiresFallbackScan: false,
                root: rootVm,
                stateMachines: [],
            };
            var active = new WeakSet();
            function walk(instance) {
                if (!instance || typeof instance !== 'object' || active.has(instance)) return;
                active.add(instance);
                var properties = Array.isArray(instance.properties) ? instance.properties : [];
                properties.forEach(function (property) {
                    var name = property && property.name;
                    if (typeof name !== 'string' || !name) return;
                    var nested = safeVmCall(instance, 'viewModelInstance', name)
                        || safeVmCall(instance, 'viewModel', name);
                    if (nested && nested !== instance) {
                        tracker.nested.push({ instance: nested, name: name, owner: instance });
                        walk(nested);
                    }
                    var list = safeVmCall(instance, 'list', name);
                    if (!list) return;
                    var length = getCanonicalListLength(list);
                    var items = getCanonicalListItems(list, length);
                    var reactive = subscribeRenderSurfaceListTopology(list, bridgeState, tracker);
                    tracker.lists.push({
                        accessor: list,
                        items: items,
                        length: length,
                        name: name,
                        owner: instance,
                        reactive: reactive,
                    });
                    items.forEach(walk);
                });
                active.delete(instance);
            }
            walk(rootVm);
            var names = Array.isArray(riveInstance && riveInstance.stateMachineNames)
                ? riveInstance.stateMachineNames.filter(Boolean)
                : [];
            tracker.stateMachines = names.map(function (name) {
                var inputs = [];
                try { inputs = riveInstance.stateMachineInputs(name) || []; } catch (e) { inputs = []; }
                return {
                    name: name,
                    inputs: Array.isArray(inputs) ? inputs.map(function (input) {
                        return String((input && input.name) || '') + ':' + String(getStateMachineInputKind(input) || '');
                    }) : [],
                };
            });
            return tracker;
        }

        function renderSurfaceTopologyChanged(bridgeState, forceFallbackScan) {
            var tracker = bridgeState.topologyTracker;
            if (bridgeState.topologyDirty) return true;
            if (!tracker || tracker.root !== resolveVmRootInstance()) return true;
            if (!tracker.requiresFallbackScan || !forceFallbackScan) return false;
            for (var listIndex = 0; listIndex < tracker.lists.length; listIndex++) {
                var trackedList = tracker.lists[listIndex];
                if (trackedList.reactive) continue;
                var currentList = safeVmCall(trackedList.owner, 'list', trackedList.name);
	                if (runtimeIdentityChanged(trackedList.accessor, currentList)) return true;
                var currentLength = getCanonicalListLength(currentList);
                if (currentLength !== trackedList.length) return true;
                for (var itemIndex = 0; itemIndex < currentLength; itemIndex++) {
                    var currentItem = null;
                    try { currentItem = currentList.instanceAt(itemIndex); } catch (e) { /* noop */ }
	                    if (runtimeIdentityChanged(trackedList.items[itemIndex], currentItem)) return true;
                }
            }
            return false;
        }

        function probeRenderSurfaceFallbackTopology(bridgeState, budget) {
            var tracker = bridgeState && bridgeState.topologyTracker;
            if (!tracker || !tracker.requiresFallbackScan || !tracker.lists.length) return false;
            var remaining = Math.max(1, Math.floor(Number(budget) || 1));
            while (remaining > 0) {
                var trackedList = null;
                var visited = 0;
                while (visited < tracker.lists.length) {
                    var listIndex = tracker.fallbackListCursor % tracker.lists.length;
                    tracker.fallbackListCursor = (listIndex + 1) % tracker.lists.length;
                    visited += 1;
                    if (!tracker.lists[listIndex].reactive) {
                        trackedList = tracker.lists[listIndex];
                        break;
                    }
                }
                if (!trackedList) return false;
                var currentList = safeVmCall(trackedList.owner, 'list', trackedList.name);
                var currentLength = getCanonicalListLength(currentList);
                if (runtimeIdentityChanged(trackedList.accessor, currentList)
                    || currentLength !== trackedList.length) {
                    bridgeState.topologyDirty = true;
                    scheduleRenderSurfaceCanonicalRefresh('topology-fallback', true);
                    return true;
                }
                if (currentLength > 0) {
                    var itemIndex = tracker.fallbackItemCursor % currentLength;
                    tracker.fallbackItemCursor = (itemIndex + 1) % currentLength;
                    var currentItem = null;
                    try { currentItem = currentList.instanceAt(itemIndex); } catch (e) { /* noop */ }
                    if (runtimeIdentityChanged(trackedList.items[itemIndex], currentItem)) {
                        bridgeState.topologyDirty = true;
                        scheduleRenderSurfaceCanonicalRefresh('topology-fallback', true);
                        return true;
                    }
                }
                remaining -= 1;
            }
            return false;
        }
