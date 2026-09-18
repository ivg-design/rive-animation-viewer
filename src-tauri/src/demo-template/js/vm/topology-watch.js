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

        function currentRenderSurfaceTopologyRoots(rootVm) {
            var roots = [{ name: '<root>', instance: rootVm }];
            getGlobalViewModelNames().sort().forEach(function (name) {
                roots.push({ name: 'gvm:' + name, instance: resolveGlobalVmRootInstance(name) });
            });
            return roots;
        }

        function topologyRootsChanged(tracker, rootVm) {
            var currentRoots = currentRenderSurfaceTopologyRoots(rootVm);
            var trackedRoots = tracker && tracker.roots;
            if (!Array.isArray(trackedRoots) || trackedRoots.length !== currentRoots.length) return true;
            return currentRoots.some(function (current, index) {
                var tracked = trackedRoots[index];
                return !tracked || tracked.name !== current.name
                    || runtimeIdentityChanged(tracked.instance, current.instance);
            });
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
                roots: currentRenderSurfaceTopologyRoots(rootVm),
            };
            var active = new WeakSet();

            function trackList(instance, name, list) {
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
                return items;
            }

            function walkRuntime(instance) {
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
                        walkRuntime(nested);
                    }
                    var list = safeVmCall(instance, 'list', name);
                    if (!list) return;
                    trackList(instance, name, list).forEach(walkRuntime);
                });
                active.delete(instance);
            }

            function walkMapped(instance, mappedInstance, index) {
                if (!instance || typeof instance !== 'object' || active.has(instance)) return;
                var prototype = index.prototypesById.get(mappedInstance && mappedInstance.prototypeId)
                    || index.prototypesByName.get(mappedInstance && mappedInstance.prototypeName);
                if (!prototype || !Array.isArray(prototype.properties)) {
                    walkRuntime(instance);
                    return;
                }
                active.add(instance);
                prototype.properties.forEach(function (property) {
                    if (!property || typeof property.name !== 'string' || !property.name) return;
                    if (property.kind === 'viewmodel') {
                        var nested = safeVmCall(instance, 'viewModelInstance', property.name)
                            || safeVmCall(instance, 'viewModel', property.name);
                        if (!nested || nested === instance) return;
                        tracker.nested.push({ instance: nested, name: property.name, owner: instance });
                        var mappedChild = (mappedInstance.nestedInstances || []).find(function (relation) {
                            return relation && relation.propertyName === property.name;
                        });
                        mappedChild = mappedChild && mappedChild.instance;
                        if (!mappedChild && property.viewModelRef) {
                            var childPrototype = index.prototypesById.get(property.viewModelRef);
                            if (childPrototype) {
                                mappedChild = {
                                    prototypeId: childPrototype.id,
                                    prototypeName: childPrototype.name,
                                    nestedInstances: [],
                                };
                            }
                        }
                        if (mappedChild) walkMapped(nested, mappedChild, index);
                        else walkRuntime(nested);
                        return;
                    }
                    if (property.kind !== 'list') return;
                    var list = safeVmCall(instance, 'list', property.name);
                    if (!list) return;
                    trackList(instance, property.name, list).forEach(function (item) {
                        var mappedItem = mappedInstanceForLiveVm(index, item, null);
                        if (mappedItem) walkMapped(item, mappedItem, index);
                        else walkRuntime(item);
                    });
                });
                active.delete(instance);
            }

            var inspectionIndex = getInspectionVmIndex();
            var mappedRoots = inspectionIndex && tracker.roots.map(function (entry) {
                return mappedInstanceForLiveVm(
                    inspectionIndex,
                    entry.instance,
                    entry.name.indexOf('gvm:') === 0 ? entry.name.slice(4) : null
                );
            });
            if (inspectionIndex && mappedRoots.every(Boolean)) {
                tracker.discovery = 'inspection-map';
                tracker.roots.forEach(function (entry, index) {
                    walkMapped(entry.instance, mappedRoots[index], inspectionIndex);
                });
            } else {
                tracker.discovery = 'runtime-fallback';
                tracker.roots.forEach(function (entry) { walkRuntime(entry.instance); });
            }
            return tracker;
        }

        function renderSurfaceTopologyChanged(bridgeState, forceFallbackScan) {
            var tracker = bridgeState.topologyTracker;
            if (bridgeState.topologyDirty) return true;
            if (!tracker || topologyRootsChanged(tracker, resolveVmRootInstance())) return true;
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
