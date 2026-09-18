        function captureRenderSurfaceStaticState() {
            var rootVm = resolveVmRootInstance();
            var target = window.__ravRenderSurfaceTarget || {};
            var defaultDefinition = null;
            try {
                defaultDefinition = riveInstance && typeof riveInstance.defaultViewModel === 'function'
                    ? riveInstance.defaultViewModel()
                    : null;
            } catch (e) { defaultDefinition = null; }
            return {
                artboard: readCanonicalMember(riveInstance && riveInstance.artboard, 'name') || CONFIG.artboardName || null,
                vmInstance: {
                    key: target.vmInstanceKey == null ? (CONFIG.viewModelInstanceName || null) : target.vmInstanceKey,
                    name: readCanonicalMember(rootVm, 'name') || readCanonicalMember(rootVm, 'instanceName'),
                    definition: readCanonicalMember(rootVm, 'viewModelName') || readCanonicalMember(defaultDefinition, 'name'),
                    availableKeys: captureAvailableVmInstanceKeys(),
                },
                animationNames: Array.isArray(riveInstance && riveInstance.animationNames)
                    ? riveInstance.animationNames.filter(Boolean) : [],
                artboards: CONFIG.inspectionMetadata && Array.isArray(CONFIG.inspectionMetadata.artboards)
                    ? CONFIG.inspectionMetadata.artboards.map(function (artboard) { return artboard && artboard.name; }).filter(Boolean) : [],
                embeddedImageAssets: typeof getEmbeddedImageAssetCatalog === 'function'
                    ? getEmbeddedImageAssetCatalog()
                    : [],
                stateMachines: Array.isArray(riveInstance && riveInstance.stateMachineNames)
                    ? riveInstance.stateMachineNames.filter(Boolean) : [],
            };
        }

        function createRenderSurfaceBridgeState() {
            return {
                canonicalPublishingEnabled: !Boolean(window.__ravRenderSurfaceDefersCanonical),
                bindingsInvalidatedForReset: false,
                controlBindings: [],
                controlBindingIndex: new Map(),
                controlObserverCursor: 0,
                controlObserverPasses: 0,
                controlObserverReads: 0,
                hotControlKeys: new Map(),
                watchControlKeys: [],
                initialSnapshotPublished: false,
                initialSnapshotScheduled: false,
                lastPublishedAt: 0,
                stateRevision: 0,
                topologyRevision: 0,
                topologyTracker: null,
                topologyDirty: false,
                topologyUnsubscribers: [],
                pendingControlChanges: new Map(),
                lastTopologyScanAt: 0,
                playbackTarget: null,
                refreshScheduled: false,
                triggerReceipts: new Map(),
                timelineSnapshot: null,
            };
        }

        function getRenderSurfaceBridgeState() {
            return window.__ravRenderSurfaceCanonical
                || (window.__ravRenderSurfaceCanonical = createRenderSurfaceBridgeState());
        }

	        // Rive Web's change subscriptions invoke every subscribed callback
	        // from handleCallbacks() on each rendered frame, so subscribing all
	        // controls would move, not remove, the O(file-size) work. This
	        // observer instead does a bounded number of cached-accessor reads
	        // per advance, split across two "always read" tiers (see
	        // observer/hot-set.js, observer/watch-set.js) -- up to HOT_SET_CAP
	        // recently-changed and WATCH_SET_CAP host-watched controls, so a
	        // value that changes every frame is still sampled every frame -- plus
	        // a cold round-robin of RENDER_SURFACE_CONTROL_READ_BUDGET (16)
	        // controls/advance for everything else, unchanged from before this
	        // tiering: a 999-control surface with nothing hot/watched is fully
	        // revisited in ceil(999/16)/60 = 1.05s at 60fps. Total reads/advance
	        // is therefore bounded at HOT_SET_CAP + WATCH_SET_CAP +
	        // RENDER_SURFACE_CONTROL_READ_BUDGET regardless of file size.
	        var RENDER_SURFACE_CONTROL_READ_BUDGET = 16;
	        var RENDER_SURFACE_CHANGE_DRAIN_BUDGET = 128;
	        var RENDER_SURFACE_FRAME_FALLBACK_MS = 250;

	        function normalizeObservedRenderSurfaceValue(kind, value) {
	            if (kind === 'boolean') return Boolean(value);
	            if (kind === 'number' || kind === 'color') {
	                var numeric = Number(value);
	                return Number.isFinite(numeric) ? numeric : null;
	            }
	            if (kind === 'string' || kind === 'enum') {
	                return typeof value === 'string' ? value : '';
	            }
	            return null;
	        }

	        function queueRenderSurfaceControlChange(bridgeState, binding, change) {
	            if (!bridgeState || !binding || !binding.key || !change) return false;
	            bridgeState.pendingControlChanges.set(binding.key, Object.assign({
	                key: binding.key,
	                kind: binding.kind,
	            }, change));
	            return true;
	        }

	        function observeRenderSurfaceBinding(bridgeState, binding) {
	            if (!binding || !binding.key) return false;
	            if (binding.kind === 'trigger') {
	                var receipt = Number(bridgeState.triggerReceipts.get(binding.key)) || 0;
	                if (receipt === binding.receipt) return false;
	                binding.receipt = receipt;
	                return queueRenderSurfaceControlChange(bridgeState, binding, { receipt: receipt });
	            }
	            if (binding.kind === 'image') {
	                var present = readCanonicalImagePresence(binding.descriptor, binding.accessor);
	                var metadata = readCanonicalImageMetadata(binding.descriptor);
	                if (present === binding.present && canonicalImageMetadataEqual(metadata, binding.metadata)) return false;
	                binding.present = present;
	                binding.metadata = metadata;
	                return queueRenderSurfaceControlChange(bridgeState, binding, {
	                    metadata: metadata,
	                    present: present,
	                });
	            }
	            var value = readCanonicalControlValue(binding.kind, binding.accessor);
	            if (binding.kind === 'enum') {
	                var values = readEnumValues(binding.accessor);
	                var previousValues = binding.values || [];
	                var choicesChanged = values.length !== previousValues.length
	                    || values.some(function (entry, index) { return entry !== previousValues[index]; });
	                if (!choicesChanged && Object.is(value, binding.value)) return false;
	                binding.values = values;
	                binding.value = normalizeObservedRenderSurfaceValue(binding.kind, value);
	                // Send both fields: later observations coalesce by control key.
	                return queueRenderSurfaceControlChange(bridgeState, binding, {
	                    value: binding.value, values: values.slice(),
	                });
	            }
	            if (Object.is(value, binding.value)) return false;
	            binding.value = normalizeObservedRenderSurfaceValue(binding.kind, value);
	            return queueRenderSurfaceControlChange(bridgeState, binding, { value: binding.value });
	        }

	        // Reads every currently-hot or currently-watched binding once. Both
	        // tiers share one pass so a key present in both (a watched control
	        // that also happens to be changing) is never read twice in the same
	        // advance. Returns the set of keys it covered, so the cold
	        // round-robin below can skip them for this advance.
	        function observeRenderSurfaceAlwaysReadTier(bridgeState) {
	            var index = bridgeState.controlBindingIndex;
	            var covered = new Set();
	            var reads = 0;
	            function readOnce(key) {
	                if (covered.has(key)) return;
	                var binding = index.get(key);
	                if (!binding || binding.kind === 'trigger') return;
	                covered.add(key);
	                var changed = observeRenderSurfaceBinding(bridgeState, binding);
	                noteRenderSurfaceControlObservation(bridgeState, key, changed);
	                reads += 1;
	            }
	            (bridgeState.watchControlKeys || []).forEach(readOnce);
	            Array.from(bridgeState.hotControlKeys.keys()).forEach(readOnce);
	            return { covered: covered, reads: reads };
	        }

	        function observeRenderSurfaceControlBudget(bridgeState, budget) {
	            if (!bridgeState || !bridgeState.canonicalPublishingEnabled || !bridgeState.initialSnapshotPublished) return 0;
	            if (bridgeState.topologyTracker
	                && renderSurfaceTopologyChanged(bridgeState, false)) {
	                bridgeState.topologyDirty = true;
	                scheduleRenderSurfaceCanonicalRefresh('topology-root', true);
	                return 0;
	            }
	            probeRenderSurfaceFallbackTopology(bridgeState, 1);
	            var bindings = bridgeState.controlBindings || [];
	            if (!bindings.length) return 0;
	            var alwaysRead = observeRenderSurfaceAlwaysReadTier(bridgeState);
	            var readBudget = Math.max(1, Math.floor(Number(budget) || RENDER_SURFACE_CONTROL_READ_BUDGET));
	            var reads = alwaysRead.reads;
	            var coldReads = 0;
	            var inspected = 0;
	            while (inspected < bindings.length && coldReads < readBudget) {
	                var index = bridgeState.controlObserverCursor % bindings.length;
	                bridgeState.controlObserverCursor = (index + 1) % bindings.length;
	                inspected += 1;
	                var binding = bindings[index];
	                if (!binding || binding.kind === 'trigger' || alwaysRead.covered.has(binding.key)) continue;
	                var changed = observeRenderSurfaceBinding(bridgeState, binding);
	                noteRenderSurfaceControlObservation(bridgeState, binding.key, changed);
	                coldReads += 1;
	            }
	            reads += coldReads;
	            bridgeState.controlObserverReads += reads;
	            bridgeState.controlObserverPasses += 1;
	            return reads;
	        }

	        function drainRenderSurfaceControlChanges(bridgeState, budget) {
	            if (!bridgeState || !bridgeState.pendingControlChanges.size) return [];
	            var drainBudget = Math.max(1, Math.floor(Number(budget) || RENDER_SURFACE_CHANGE_DRAIN_BUDGET));
	            var changes = [];
	            var iterator = bridgeState.pendingControlChanges.entries();
	            while (changes.length < drainBudget) {
	                var next = iterator.next();
	                if (next.done) break;
	                bridgeState.pendingControlChanges.delete(next.value[0]);
	                changes.push(next.value[1]);
	            }
	            return changes;
	        }

	        function resetRenderSurfaceControlObserver(bridgeState) {
	            if (!bridgeState) return;
	            bridgeState.controlObserverCursor = 0;
	            bridgeState.pendingControlChanges.clear();
	        }

        function invalidateRenderSurfaceCanonicalBindingsForReset() {
            if (!isRenderSurfaceMode) return false;
            var bridgeState = getRenderSurfaceBridgeState();
            bridgeState.canonicalPublishingEnabled = false;
            bridgeState.bindingsInvalidatedForReset = true;
            cleanupRenderSurfaceTopologySubscriptions(bridgeState);
            resetRenderSurfaceControlObserver(bridgeState);
            // A reset can jump every value; a pre-reset "recently changed"
            // streak says nothing about the post-reset file. The watch set is
            // independent host/UI state (which drawer rows are open) and
            // stays intact across reset.
            resetRenderSurfaceHotSet(bridgeState);
            bridgeState.controlBindings = [];
            bridgeState.controlBindingIndex = new Map();
            bridgeState.topologyTracker = null;
            bridgeState.topologyDirty = true;
            bridgeState.refreshScheduled = false;
            return true;
        }

	        function getRenderSurfaceObserverDiagnostics(bridgeState) {
	            var state = bridgeState || getRenderSurfaceBridgeState();
	            return {
	                changeDrainBudget: RENDER_SURFACE_CHANGE_DRAIN_BUDGET,
	                controlCount: (state.controlBindings || []).length,
	                cursor: state.controlObserverCursor,
	                hot: getRenderSurfaceHotSetDiagnostics(state),
	                passes: state.controlObserverPasses,
	                pendingChanges: state.pendingControlChanges.size,
	                readBudget: RENDER_SURFACE_CONTROL_READ_BUDGET,
	                reads: state.controlObserverReads,
	                topologyDiscovery: state.topologyTracker && state.topologyTracker.discovery || null,
	                watch: getRenderSurfaceWatchSetDiagnostics(state),
	            };
	        }

        function publishRenderSurfaceCanonicalState(force, reason, forceTopologyScan) {
            if (!isRenderSurfaceMode || typeof window.__ravRenderSurfaceEmit !== 'function' || !riveInstance) return null;
            var bridgeState = getRenderSurfaceBridgeState();
            if (!bridgeState.canonicalPublishingEnabled && reason !== 'load') return null;
            var now = performance.now();
            // A value-only delta is cheap (one Map drain) and publishes on
            // every advance so drawer readouts track the render rate. The
            // floor exists to bound the cost of an expensive full topology
            // walk (or the very first snapshot), so it applies only while
            // one of those is actually pending -- exactly when there is no
            // topology tracker yet, or the tracker has been marked dirty by
            // a list invalidation / fallback probe.
            var publishNeedsTopologyWalk = !force && (!bridgeState.topologyTracker || bridgeState.topologyDirty);
            if (publishNeedsTopologyWalk && now - bridgeState.lastPublishedAt < VM_TOPOLOGY_PUBLISH_FLOOR_MS) return null;
            // Timeline progress has its own renderer-advance event. If the
            // bounded observer found no VM changes, there is no canonical
            // payload to capture or publish on this frame.
            if (!force && bridgeState.pendingControlChanges.size === 0) return null;
            // Publishing a command acknowledgement immediately must not imply a
            // deep topology walk. List invalidation events mark topology dirty;
            // runtimes without those events use the bounded fallback cadence.
            var state = captureRenderSurfaceCanonicalState(reason, forceTopologyScan === true);
            bridgeState.lastPublishedAt = now;
            if (!force && state.stateType === 'delta' && state.controlChanges.length === 0) {
                return null;
            }
            bridgeState.stateRevision = state.stateRevision;
            if (state.controlsHierarchy) bridgeState.initialSnapshotPublished = true;
            window.__ravRenderSurfaceEmit('render-surface:state', state);
            return state;
        }

        // requestIdleCallback's timeout is only a scheduling hint. A staged
        // WebView can remain busy indefinitely and never deliver the idle
        // callback, so pair it with an independent timer. Both paths share a
        // once guard so the fallback cannot publish a second canonical state
        // when an idle callback eventually arrives as well.
        function scheduleRenderSurfaceIdleWithFallback(callback) {
            var didRun = false;
            var runOnce = function () {
                if (didRun) return;
                didRun = true;
                callback();
            };
            if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(runOnce, { timeout: 1000 });
                window.setTimeout(runOnce, 1000);
                return;
            }
            window.setTimeout(runOnce, 0);
        }

        // A staged WebView may be ready enough to process bridge commands but
        // remain hidden long enough for requestAnimationFrame to starve. Keep
        // the presentation opportunity when it is available, while installing
        // an independent bounded timer so canonical activation cannot deadlock.
        function scheduleRenderSurfaceFrameWithFallback(callback) {
            var didRun = false;
            var fallbackTimer = null;
            var runOnce = function () {
                if (didRun) return;
                didRun = true;
                if (fallbackTimer !== null && typeof window.clearTimeout === 'function') {
                    window.clearTimeout(fallbackTimer);
                }
                callback();
            };
            if (typeof window.requestAnimationFrame !== 'function') {
                window.setTimeout(runOnce, 0);
                return;
            }
            fallbackTimer = window.setTimeout(runOnce, RENDER_SURFACE_FRAME_FALLBACK_MS);
            window.requestAnimationFrame(runOnce);
        }

        function scheduleRenderSurfaceInitialCanonicalState() {
            if (!isRenderSurfaceMode || !riveInstance) return false;
            var bridgeState = getRenderSurfaceBridgeState();
            if (bridgeState.initialSnapshotScheduled || bridgeState.initialSnapshotPublished) return false;
            bridgeState.initialSnapshotScheduled = true;

            var publishInitialSnapshot = function () {
                // Enable periodic publications only inside the task that owns
                // the first complete snapshot. Until this point, onAdvance is
                // intentionally O(1) and cannot race the activation beacon.
                bridgeState.canonicalPublishingEnabled = true;
                try {
                    var snapshot = publishRenderSurfaceCanonicalState(true, 'activation', true);
                    if (!snapshot || !snapshot.controlsHierarchy) {
                        throw new Error('Initial canonical controls snapshot was unavailable.');
                    }
                    bridgeState.initialSnapshotPublished = true;
                } catch (error) {
                    // Never publish partial authority. Leave the surface usable
                    // for playback, report the bounded observer failure, and
                    // keep automatic publications gated rather than retrying a
                    // failing deep traversal every frame.
                    bridgeState.canonicalPublishingEnabled = false;
                    bridgeState.initialSnapshotScheduled = false;
                    if (typeof window.__ravRenderSurfaceEmit === 'function') {
                        window.__ravRenderSurfaceEmit('render-surface:error', {
                            message: String((error && error.message) || error),
                            phase: 'canonical-initial-snapshot',
                            recoverable: true,
                        });
                    }
                }
            };
            // The prepare-frame ACK is transported before this function runs.
            // Cross one more presentation opportunity so the parent can commit
            // native visibility before the eventual controls discovery task.
            scheduleRenderSurfaceFrameWithFallback(function () {
                scheduleRenderSurfaceIdleWithFallback(publishInitialSnapshot);
            });
            return true;
        }

        function scheduleRenderSurfaceCanonicalRefresh(reason, forceTopologyScan) {
            if (!isRenderSurfaceMode || !riveInstance) return false;
            var bridgeState = getRenderSurfaceBridgeState();
            if (reason === 'reset-first-frame' && bridgeState.bindingsInvalidatedForReset) {
                bridgeState.bindingsInvalidatedForReset = false;
                bridgeState.canonicalPublishingEnabled = true;
            }
            if (!bridgeState.canonicalPublishingEnabled || bridgeState.refreshScheduled) return false;
            bridgeState.refreshScheduled = true;
            var publishRefresh = function () {
                bridgeState.refreshScheduled = false;
                try {
                    publishRenderSurfaceCanonicalState(true, reason || 'refresh', forceTopologyScan === true);
                } catch (error) {
                    // A failed deep read cannot revoke the already-confirmed
                    // reset or replace canonical authority with partial data.
                    bridgeState.canonicalPublishingEnabled = false;
                    if (typeof window.__ravRenderSurfaceEmit === 'function') {
                        window.__ravRenderSurfaceEmit('render-surface:error', {
                            message: String((error && error.message) || error),
                            phase: 'canonical-refresh',
                            recoverable: true,
                        });
                    }
                }
            };
            scheduleRenderSurfaceFrameWithFallback(function () {
                scheduleRenderSurfaceIdleWithFallback(publishRefresh);
            });
            return true;
        }
