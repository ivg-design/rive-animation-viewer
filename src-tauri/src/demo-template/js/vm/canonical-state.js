        function readCanonicalMember(target, propertyName) {
            if (!target) return null;
            try {
                var value = target[propertyName];
                if (typeof value === 'function') value = value.call(target);
                if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
            } catch (e) { /* noop */ }
            return null;
        }

        function readEnumValues(accessor) {
            if (!accessor) return [];
            try {
                var values = accessor.values;
                if (typeof values === 'function') values = values.call(accessor);
                return Array.isArray(values)
                    ? values.filter(function (value) { return typeof value === 'string'; })
                    : [];
            } catch (e) {
                return [];
            }
        }

        function readCanonicalControlValue(kind, accessor) {
            if (!accessor || !('value' in accessor)) return null;
            var value = null;
            try { value = accessor.value; } catch (e) { return null; }
            if (kind === 'boolean') return Boolean(value);
            if (kind === 'number' || kind === 'color') {
                var numeric = Number(value);
                return Number.isFinite(numeric) ? numeric : null;
            }
            if (kind === 'string' || kind === 'enum') return typeof value === 'string' ? value : '';
            return null;
        }

        function readCanonicalImagePresence(descriptor, accessor) {
            var acknowledgedPresence = readAcknowledgedRenderSurfaceImagePresence(descriptor);
            if (acknowledgedPresence !== null) return acknowledgedPresence;
            if (!accessor || !('value' in accessor)) return false;
            try { return accessor.value != null; } catch (e) { return false; }
        }

        function readCanonicalImageMetadata(descriptor) {
            return readAcknowledgedRenderSurfaceImageMetadata(descriptor);
        }

        function canonicalImageMetadataEqual(left, right) {
            if (left === right) return true;
            if (!left || !right) return false;
            return left.kind === right.kind && left.key === right.key && left.label === right.label;
        }

        function canonicalizeControlHierarchyNode(node, bridgeState) {
            if (!node || typeof node !== 'object') return null;
            var inputs = (node.inputs || []).map(function (input) {
                var descriptor = normalizeControlDescriptor(input);
                if (!descriptor) return null;
                var key = controlSnapshotKeyForDescriptor(descriptor);
                var accessor = resolveControlAccessor(descriptor);
                var canonicalInput = {
                    descriptor: descriptor,
                    kind: descriptor.kind,
                    name: descriptor.name,
                    path: descriptor.path,
                    source: descriptor.source,
                    globalViewModelName: descriptor.globalViewModelName,
                    stateMachineName: descriptor.stateMachineName,
                    values: descriptor.kind === 'enum' ? readEnumValues(accessor) : [],
                };
                var binding = { accessor: accessor, descriptor: descriptor, key: key, kind: descriptor.kind };
                if (descriptor.kind === 'image') {
                    binding.present = readCanonicalImagePresence(descriptor, accessor);
                    binding.metadata = readCanonicalImageMetadata(descriptor);
                    canonicalInput.present = binding.present;
                    canonicalInput.metadata = binding.metadata;
                } else if (descriptor.kind === 'trigger') {
                    binding.receipt = Number(bridgeState.triggerReceipts.get(key)) || 0;
                    canonicalInput.receipt = binding.receipt;
                } else {
                    binding.value = readCanonicalControlValue(descriptor.kind, accessor);
                    canonicalInput.value = binding.value;
                }
                bridgeState.controlBindings.push(binding);
                if (binding.key) bridgeState.controlBindingIndex.set(binding.key, binding);
                return canonicalInput;
            }).filter(Boolean);
            return {
                label: node.label || '',
                path: node.path || '',
                kind: node.kind || 'vm',
                source: node.source,
                globalViewModelName: node.globalViewModelName,
                inputs: inputs,
                children: (node.children || [])
                    .map(function (child) { return canonicalizeControlHierarchyNode(child, bridgeState); })
                    .filter(Boolean),
            };
        }

        function captureRenderSurfaceControlsHierarchy(bridgeState) {
            bridgeState.controlBindings = [];
            bridgeState.controlBindingIndex = new Map();
            resetRenderSurfaceControlObserver(bridgeState);
            var rootVm = resolveVmRootInstance();
            var vmHierarchy = rootVm ? filterHierarchyNode(buildVmHierarchy(rootVm)) : null;
            var globalVmHierarchies = getGlobalViewModelNames().map(function (name) {
                var instance = resolveGlobalVmRootInstance(name);
                return instance ? filterHierarchyNode(buildVmHierarchy(instance, name)) : null;
            }).filter(Boolean);
            var globalVmGroup = globalVmHierarchies.length ? {
                label: 'Global VM',
                path: '__global_view_models__',
                kind: 'global-view-models',
                inputs: [],
                children: globalVmHierarchies,
            } : null;
            var smHierarchy = filterHierarchyNode(buildStateMachineHierarchy());
            return {
                label: 'Controls',
                path: '<controls>',
                kind: 'controls',
                inputs: [],
                children: [globalVmGroup, vmHierarchy, smHierarchy]
                    .filter(Boolean)
                    .map(function (node) { return canonicalizeControlHierarchyNode(node, bridgeState); }),
            };
        }

        function captureRenderSurfacePlayback() {
            var playingAnimations = Array.isArray(riveInstance && riveInstance.playingAnimationNames)
                ? riveInstance.playingAnimationNames.filter(Boolean)
                : [];
            var playingStateMachines = Array.isArray(riveInstance && riveInstance.playingStateMachineNames)
                ? riveInstance.playingStateMachineNames.filter(Boolean)
                : [];
            var bridgeState = getRenderSurfaceBridgeState();
            // The bridge, not a runtime name list (or an incidental write to
            // the window scratch global), owns the selected playback target.
            // A direct linear animation may finish after the runtime has
            // pruned its wrapper and resumed reporting the artboard's default
            // state machine. Its completed target must remain authoritative
            // until a later child reset explicitly changes it.
            var target = bridgeState.playbackTarget || window.__ravRenderSurfaceTarget || {};
            // A direct timeline remains the selected playback target after its
            // wrapper completes and the runtime prunes it. Some files expose
            // their default state machine in `playingStateMachineNames` even
            // while that direct timeline owns the visible result. Do not let
            // that residual runtime name turn a completed animation into a
            // state-machine selection: the reset command is the acknowledged
            // authority that changes the target to a state machine.
            var explicitPlaybackTarget = (target.type === 'animation' || target.type === 'stateMachine')
                && Boolean(target.name);
            var type = playingAnimations.length ? 'animation' : (explicitPlaybackTarget
                ? target.type
                : (playingStateMachines.length ? 'stateMachine' : (target.type || null)));
            var name = playingAnimations[0] || (explicitPlaybackTarget
                ? target.name
                : (playingStateMachines[0] || target.name || null));
            var metrics = type === 'animation' ? captureActiveTimelineMetrics(name) : null;
            if (metrics && target.type === 'animation' && target.name === name) {
                rememberActiveTimelineMetrics(bridgeState, target, metrics);
            } else if (type === 'animation' && timelineSnapshotMatchesTarget(bridgeState.timelineSnapshot, target)) {
                // Finished direct timelines are pruned by the runtime. Keep the
                // last child-confirmed terminal snapshot rather than replacing
                // the readout with unknown values after the wrapper vanishes.
                metrics = bridgeState.timelineSnapshot.metrics;
            } else if (target.type !== 'animation') {
                bridgeState.timelineSnapshot = null;
            }
            var isPlaying = Boolean(riveInstance && riveInstance.isPlaying);
            return {
                type: type,
                name: name,
                isPlaying: isPlaying,
                isPaused: !isPlaying,
                currentFrame: metrics && metrics.currentFrame,
                currentSeconds: metrics && metrics.currentSeconds,
                durationSeconds: metrics && metrics.totalSeconds,
                fps: metrics && metrics.fps,
                totalFrames: metrics && metrics.totalFrames,
                totalSeconds: metrics && metrics.totalSeconds,
            };
        }

        function captureAvailableVmInstanceKeys() {
            try {
                var definition = riveInstance && typeof riveInstance.defaultViewModel === 'function'
                    ? riveInstance.defaultViewModel()
                    : null;
                var names = definition && definition.instanceNames;
                if (typeof names === 'function') names = names.call(definition);
                var instanceCount = definition && definition.instanceCount;
                if (typeof instanceCount !== 'number' || instanceCount < 1) return [];
                return Array.from({ length: instanceCount }, function (_unused, index) {
                    var name = Array.isArray(names) && typeof names[index] === 'string'
                        ? names[index].trim()
                        : '';
                    return name || String(index);
                });
            } catch (e) {
                return [];
            }
        }

        // Call this only from the child load/reset contract. Runtime events
        // must report against this selected target; they cannot replace it.
        function setRenderSurfacePlaybackTarget(rawTarget) {
            var target = rawTarget && typeof rawTarget === 'object' ? rawTarget : {};
            var normalized = {
                name: typeof target.name === 'string' && target.name ? target.name : null,
                type: target.type === 'animation' || target.type === 'stateMachine' ? target.type : null,
                vmInstanceKey: target.vmInstanceKey == null ? null : target.vmInstanceKey,
            };
            var bridgeState = getRenderSurfaceBridgeState();
            bridgeState.playbackTarget = normalized;
            // A reset to a different target invalidates a terminal snapshot
            // from the previous linear animation immediately.
            if (normalized.type !== 'animation'
                || !timelineSnapshotMatchesTarget(bridgeState.timelineSnapshot, normalized)) {
                bridgeState.timelineSnapshot = null;
            }
            window.__ravRenderSurfaceTarget = normalized;
            return normalized;
        }

        function recordRenderSurfaceTriggerReceipt(descriptor) {
            if (!isRenderSurfaceMode) return 0;
            var key = controlSnapshotKeyForDescriptor(descriptor);
            if (!key) return 0;
            var bridgeState = getRenderSurfaceBridgeState();
            var receipt = (Number(bridgeState.triggerReceipts.get(key)) || 0) + 1;
            bridgeState.triggerReceipts.set(key, receipt);
            var binding = bridgeState.controlBindingIndex.get(key);
            if (binding) {
                binding.receipt = receipt;
                queueRenderSurfaceControlChange(bridgeState, binding, { receipt: receipt });
            }
            return receipt;
        }

        function captureChangedRenderSurfaceControls(bridgeState) {
            return drainRenderSurfaceControlChanges(bridgeState);
        }

        // Command acknowledgements must not wait for a full canonical scan.
        // A file with hundreds of live bindings can make even a delta scan
        // expensive because every accessor has to be read.  The command path
        // already has the exact descriptor and child-confirmed readback, so
        // publish that one mutation as an ACK-carried delta and update the
        // cached binding in place.  The regular reactive/advance publication
        // remains responsible for unrelated runtime changes.
        function captureRenderSurfaceCommandCanonicalDelta(command, result) {
            var type = String(command && (command.type || command.command) || '').toLowerCase();
            var targetedControl = type === 'vm-set' || type === 'vm-fire'
                || type === 'sm-set' || type === 'sm-fire'
                || type === 'vm-image-set';
            var lightweightState = type === 'snapshot' || type === 'presentation'
                || type === 'activate-callbacks' || type === 'prepare-frame'
                || type === 'reset' || type === 'play' || type === 'pause' || type === 'scrub';
            if ((!targetedControl && !lightweightState) || !result || typeof result !== 'object') return null;

            var payload = command && command.payload && typeof command.payload === 'object'
                ? command.payload : command || {};
            var bridgeState = getRenderSurfaceBridgeState();
            var nextRevision = bridgeState.stateRevision + 1;
            var delta = {
                protocolVersion: 2,
                reason: 'command:' + type,
                revision: nextRevision,
                stateRevision: nextRevision,
                stateType: 'delta',
                topologyRevision: bridgeState.topologyRevision,
                playback: captureRenderSurfacePlayback(),
                controlChanges: [],
            };
            if (!targetedControl) {
                // Reset can change the selected artboard/playback/instance while
                // keeping the same outer Rive wrapper. Carry those bounded
                // child-confirmed fields in its ACK; the complete Properties
                // hierarchy remains an eventual post-ACK refresh.
                if (type === 'reset') Object.assign(delta, captureRenderSurfaceStaticState());
                bridgeState.stateRevision = nextRevision;
                bridgeState.lastPublishedAt = performance.now();
                return delta;
            }
            var descriptor = normalizeControlDescriptor(result.descriptor || payload.descriptor || payload);
            if (!descriptor) return null;
            if (type === 'vm-fire' || type === 'sm-fire') descriptor.kind = 'trigger';
            if (type === 'vm-image-set') descriptor.kind = 'image';
            var key = controlSnapshotKeyForDescriptor(descriptor);
            if (!key) return null;

            var change = { key: key, kind: descriptor.kind };
            if (descriptor.kind === 'trigger') {
                change.receipt = Number(bridgeState.triggerReceipts.get(key)) || 0;
            } else if (descriptor.kind === 'image') {
                change.present = readCanonicalImagePresence(descriptor, null);
                change.metadata = readCanonicalImageMetadata(descriptor);
            } else {
                change.value = result.value;
            }

            // Keep the next periodic scan from emitting the acknowledged
            // mutation a second time. This is cache reconciliation only; it
            // never writes the runtime accessor or re-fires a trigger.
            var binding = bridgeState.controlBindingIndex.get(key);
            if (binding) {
                if (descriptor.kind === 'trigger') binding.receipt = change.receipt;
                else if (descriptor.kind === 'image') {
                    binding.present = change.present;
                    binding.metadata = change.metadata;
                } else binding.value = change.value;
            }
            bridgeState.pendingControlChanges.delete(key);

            bridgeState.stateRevision = nextRevision;
            bridgeState.lastPublishedAt = performance.now();
            delta.controlChanges = [change];
            return delta;
        }

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
                artboards: riveInstance && riveInstance.contents && Array.isArray(riveInstance.contents.artboards)
                    ? riveInstance.contents.artboards.map(function (artboard) { return artboard && artboard.name; }).filter(Boolean) : [],
                stateMachines: Array.isArray(riveInstance && riveInstance.stateMachineNames)
                    ? riveInstance.stateMachineNames.filter(Boolean) : [],
            };
        }

        function captureRenderSurfaceCanonicalState(reason, forceTopologyScan) {
            var bridgeState = getRenderSurfaceBridgeState();
            var nextRevision = bridgeState.stateRevision + 1;
            var playback = captureRenderSurfacePlayback();
            // The first child receipt is intentionally hierarchy-free. Static
            // selection/playback fields are authoritative and bounded, while
            // the Properties topology is materialized only after activation.
            if (reason === 'load' && !bridgeState.initialSnapshotPublished) {
                return Object.assign(captureRenderSurfaceStaticState(), {
                    protocolVersion: 2,
                    reason: reason,
                    revision: nextRevision,
                    stateRevision: nextRevision,
                    stateType: 'bootstrap',
                    topologyRevision: bridgeState.topologyRevision,
                    playback: playback,
                });
            }
            // A topology walk is never entered from steady playback. The first
            // snapshot owns discovery; later list/root invalidations schedule a
            // forced idle refresh through topology-watch.js.
            var topologyChanged = !bridgeState.topologyTracker
                || (forceTopologyScan === true && renderSurfaceTopologyChanged(bridgeState, true));
            if (topologyChanged) {
                bridgeState.topologyRevision += 1;
                bridgeState.topologyTracker = captureTopologyTrackers(resolveVmRootInstance(), bridgeState);
                var snapshot = Object.assign(captureRenderSurfaceStaticState(), {
                    protocolVersion: 2,
                    reason: reason || 'runtime',
                    revision: nextRevision,
                    stateRevision: nextRevision,
                    stateType: 'snapshot',
                    topologyRevision: bridgeState.topologyRevision,
                    playback: playback,
                });
                snapshot.controlsHierarchy = captureRenderSurfaceControlsHierarchy(bridgeState);
                return snapshot;
            }
            return {
                protocolVersion: 2,
                reason: reason || 'runtime',
                revision: nextRevision,
                stateRevision: nextRevision,
                stateType: 'delta',
                topologyRevision: bridgeState.topologyRevision,
                playback: playback,
                controlChanges: captureChangedRenderSurfaceControls(bridgeState),
            };
        }
