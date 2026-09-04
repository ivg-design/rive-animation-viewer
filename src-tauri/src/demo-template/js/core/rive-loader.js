        function loadAnimation() {
            if (!els.canvas || !els.canvasContainer) {
                showError('Canvas element not found.');
                return;
            }
            updateInfo('Loading animation...');
            logEvent('native', 'load-start', 'Loading embedded animation.');
            resetEmbeddedImageAssets();
            reportRenderSurfaceLoadStage('begin');
            try {
                var rive = window.rive || window.RiveModule;
                if (!rive || typeof rive.Rive !== 'function') {
                    // Try global constructor
                    if (typeof Rive === 'function') {
                        rive = { Rive: Rive, Layout: (typeof Layout !== 'undefined') ? Layout : null };
                    } else {
                        showError('Rive runtime not found.');
                        return;
                    }
                }
                cleanupInstance();
                loadedRiveRuntime = rive;
                // Decode embedded animation from base64
                var base64Data = CONFIG.animationBase64;
                var binaryString = atob(base64Data);
                var bytes = new Uint8Array(binaryString.length);
                for (var i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                var animationBlob = new Blob([bytes], { type: 'application/octet-stream' });
                var animationUrl = URL.createObjectURL(animationBlob);
                reportRenderSurfaceLoadStage('animation-decoded');
                resizeCanvas();
                // Build Rive config
                var appliedEditorConfig = resolveStandaloneEditorConfig(
                    CONFIG.editorCode,
                    CONFIG.instantiationSourceMode,
                    function (error) {
                        logEvent('native', 'editor-config-error', 'Unable to restore applied editor config: ' + (error.message || error));
                    },
                );
                var playback = resolveStandalonePlaybackConfig(CONFIG, appliedEditorConfig);
                var configuredStateMachines = playback.stateMachines;
                var configuredAnimations = playback.animations;
                var didRestartForStateMachine = false;
                var hasEmittedInitialLoad = false;
                var reportAppliedEditorCallbackError = function (error) {
                    logEvent('native', 'editor-callback-error', 'Applied editor callback failed: ' + (error.message || error));
                };
                var riveConfig = Object.assign({}, playback.config, {
                    src: animationUrl,
                    canvas: els.canvas,
                    autoplay: CONFIG.autoplay !== false,
                    autoBind: CONFIG.viewModelInstanceName
                        ? false
                        : (typeof appliedEditorConfig.autoBind === 'boolean'
                            ? appliedEditorConfig.autoBind
                            : true),
                });
                riveConfig.assetLoader = composeEmbeddedImageAssetLoader(riveConfig.assetLoader);
                if (CONFIG.artboardName) {
                    riveConfig.artboard = CONFIG.artboardName;
                }
                var userSpecifiedStateMachines = runtimeCompatibility.getStateMachineNames(riveConfig).length > 0;
                var userSpecifiedAnimations = normalizeStateMachineSelection(riveConfig.animations).length > 0;
                configuredStateMachines = runtimeCompatibility.getStateMachineNames(riveConfig);
                configuredAnimations = normalizeStateMachineSelection(riveConfig.animations);
                setRenderSurfacePlaybackTarget({
                    name: userSpecifiedAnimations
                        ? configuredAnimations[0]
                        : (userSpecifiedStateMachines ? configuredStateMachines[0] : null),
                    type: userSpecifiedAnimations ? 'animation' : (userSpecifiedStateMachines ? 'stateMachine' : null),
                    vmInstanceKey: CONFIG.viewModelInstanceName == null ? null : CONFIG.viewModelInstanceName,
                });
                // Set layout
                if (rive.Layout) {
                    var appliedLayoutProps = appliedEditorConfig.layout && typeof appliedEditorConfig.layout === 'object'
                        ? Object.assign({}, appliedEditorConfig.layout)
                        : {};
                    delete appliedLayoutProps.fit;
                    delete appliedLayoutProps.alignment;
                    riveConfig.layout = new rive.Layout(Object.assign({
                        fit: resolveRiveLayoutFit(rive, currentLayoutFit),
                        alignment: resolveRiveLayoutAlignment(rive, currentLayoutAlignment),
                    }, appliedLayoutProps));
                }
                if (isCanvasBackgroundTransparent() && CONFIG.runtimeName !== 'canvas' && typeof riveConfig.useOffscreenRenderer === 'undefined') {
                    riveConfig.useOffscreenRenderer = true;
                }
                riveConfig.onLoad = function () {
                    runtimeCompatibility.clearStateMachineInputMetadata(riveInstance);
                    runtimeCompatibility.setInspectionMetadata(riveInstance, CONFIG.inspectionMetadata);
                    setupRenderSurfaceFrameClock(riveInstance);
                    reportRenderSurfaceLoadStage('rive-onload');
                    var callbackArgs = Array.prototype.slice.call(arguments);
                    // Auto-detect state machine if none specified
                    if (!didRestartForStateMachine && !userSpecifiedStateMachines && !userSpecifiedAnimations) {
                        var detectedSmName = null;
                        try {
                            var artboard = riveInstance && riveInstance.artboard;
                            if (artboard && typeof artboard.stateMachineCount === 'function') {
                                var count = artboard.stateMachineCount();
                                if (count > 0) {
                                    var sm = artboard.stateMachineByIndex(0);
                                    if (sm && sm.name) detectedSmName = sm.name;
                                }
                            }
                        } catch (e) { /* noop */ }
                        if (!detectedSmName) {
                            var names = Array.isArray(riveInstance && riveInstance.stateMachineNames) ? riveInstance.stateMachineNames : [];
                            if (names.length > 0) detectedSmName = names[0];
                        }
                        if (detectedSmName) {
                            didRestartForStateMachine = true;
                            clearRiveEventListeners();
                            try { riveInstance.cleanup(); } catch (e) { /* noop */ }
                            // Fresh canvas for WebGL context
                            els.canvasContainer.innerHTML = '';
                            var newCanvas = document.createElement('canvas');
                            newCanvas.id = 'rive-canvas';
                            els.canvasContainer.appendChild(newCanvas);
                            els.canvas = newCanvas;
                            resizeCanvas();
                            riveConfig.canvas = newCanvas;
                            riveConfig = runtimeCompatibility.normalizePlaybackConfig(Object.assign({}, riveConfig, {
                                animations: undefined,
                                stateMachine: detectedSmName,
                                stateMachines: undefined,
                            }), CONFIG.runtimeVersion);
                            riveInstance = new rive.Rive(riveConfig);
                            window.riveInst = riveInstance;
                            attachRiveUserEventListeners(rive, riveInstance);
                            return;
                        }
                    }
                    hideError();
                    resizeCanvas();
                    if (riveInstance) riveInstance.resizeDrawingSurfaceToCanvas();
                    reportRiveLoadStatus(riveInstance, riveConfig, userSpecifiedAnimations, configuredAnimations);
                    var requestedVmInstanceKey = window.__ravRenderSurfaceTarget
                        ? window.__ravRenderSurfaceTarget.vmInstanceKey
                        : CONFIG.viewModelInstanceName;
                    var explicitBindingRequested = requestedVmInstanceKey !== null && typeof requestedVmInstanceKey !== 'undefined';
                    // Some runtime builds emit onLoad from an in-place reset.
                    // That is not the reset lifecycle: bootstrap rebinds the
                    // requested instance immediately after reset returns, then
                    // the reset barrier restores snapshots. Do not let this
                    // incidental callback restore against the old binding.
                    var resetTransactionPending = isRenderSurfaceMode && Boolean(pendingRenderSurfaceReset);
                    var bindingApplied = resetTransactionPending
                        ? false
                        : (explicitBindingRequested
                            ? bindViewModelInstanceByKey(riveInstance, requestedVmInstanceKey)
                            : Boolean(resolveVmRootInstance()));
                    if (!resetTransactionPending) {
                        applyControlSnapshot(currentControlSnapshot);
                    }
                    // An in-place reset can happen to emit onLoad in some
                    // runtime builds, but it is not the reset completion
                    // signal. The command starts its own post-reset frame
                    // barrier so this remains a normal load-only branch.
                    // The dedicated child renderer retains the exact runtime,
                    // config, asset loader and control snapshot but never
                    // creates the standalone's DOM control tree.
                    if (!isRenderSurfaceMode) renderVmControls();
                    invokeRenderSurfaceAwareEditorCallback(
                        appliedEditorConfig.onLoad,
                        callbackArgs,
                        reportAppliedEditorCallbackError,
                        { deferUntilActivation: true }
                    );
                    if (isRenderSurfaceMode && typeof window.__ravRenderSurfaceEmit === 'function') {
                        if (hasEmittedInitialLoad) {
                            publishRenderSurfaceCanonicalState(true, 'reload');
                        } else {
                            hasEmittedInitialLoad = true;
                            // Publish only the bounded static/playback bootstrap.
                            // The full Properties topology stays gated until the
                            // parent has transported the prepare-frame ACK.
                            publishRenderSurfaceCanonicalState(true, 'load');
                            announceRenderSurfaceFirstFrame({
                                binding: {
                                    applied: bindingApplied,
                                    key: explicitBindingRequested ? requestedVmInstanceKey : null,
                                    requested: explicitBindingRequested,
                                },
                                fileName: CONFIG.fileName || null,
                                firstFrame: true,
                                protocolVersion: 2,
                                runtimeName: CONFIG.runtimeName || null,
                                runtimeVersion: CONFIG.runtimeVersion || null,
                            });
                        }
                    }
                };
                riveConfig.onLoadError = function (error) {
                    var errorMsg = (error && error.message) || String(error);
                    reportRenderSurfaceLoadStage('rive-onload-error', errorMsg);
                    showError('Error loading animation: ' + errorMsg);
                    logEvent('native', 'loaderror', 'Load error: ' + errorMsg);
                    if (pendingRenderSurfaceReset) pendingRenderSurfaceReset.reject(error);
                    invokeRenderSurfaceAwareEditorCallback(
                        appliedEditorConfig.onLoadError,
                        Array.prototype.slice.call(arguments),
                        reportAppliedEditorCallbackError
                    );
                    if (isRenderSurfaceMode && typeof window.__ravRenderSurfaceEmit === 'function') {
                        window.__ravRenderSurfaceEmit('render-surface:error', {
                            phase: 'load',
                            message: errorMsg,
                        });
                    }
                };
                riveConfig.onPlay = function (event) {
                    logEvent('native', 'play', 'Playback started by runtime.', event);
                    invokeRenderSurfaceAwareEditorCallback(appliedEditorConfig.onPlay, Array.prototype.slice.call(arguments), reportAppliedEditorCallbackError);
                    recordRenderSurfaceTimelinePlay(event);
                    publishRenderSurfaceCanonicalState(true, 'play');
                };
                riveConfig.onPause = function (event) {
                    logEvent('native', 'pause', 'Playback paused by runtime.', event);
                    invokeRenderSurfaceAwareEditorCallback(appliedEditorConfig.onPause, Array.prototype.slice.call(arguments), reportAppliedEditorCallbackError);
                    publishRenderSurfaceCanonicalState(true, 'pause');
                };
                riveConfig.onStop = function (event) {
                    logEvent('native', 'stop', 'Playback stopped by runtime.', event);
                    invokeRenderSurfaceAwareEditorCallback(appliedEditorConfig.onStop, Array.prototype.slice.call(arguments), reportAppliedEditorCallbackError);
                    recordRenderSurfaceTimelineStop(event);
                    publishRenderSurfaceCanonicalState(true, 'stop');
                };
                // Avoid automatic deprecated subscriptions unrelated to the
                // selected playback. Explicit legacy editor callbacks remain.
                configureRiveDeprecatedEventCallbacks(riveConfig, {
                    appliedEditorConfig: appliedEditorConfig,
                    reportCallbackError: reportAppliedEditorCallbackError,
                    userSpecifiedAnimations: userSpecifiedAnimations,
                    userSpecifiedStateMachines: userSpecifiedStateMachines,
                });
                riveConfig.onAdvance = function (event) { renderSurfaceAdvanceRevision += 1;
                    updatePlaybackChips();
                    retryPendingControlSnapshot();
                    recordRenderSurfaceTimelineAdvance();
                    invokeRenderSurfaceAwareEditorCallback(appliedEditorConfig.onAdvance, Array.prototype.slice.call(arguments), reportAppliedEditorCallbackError);
                    // Fixed-size cached-accessor reads revisit 999 controls in
                    // about one second at 60fps without an O(file-size) frame.
                    observeRenderSurfaceControlBudget(getRenderSurfaceBridgeState());
                    publishRenderSurfaceCanonicalState(false, 'advance');
                };
                // Remove undefined keys
                Object.keys(riveConfig).forEach(function (key) {
                    if (riveConfig[key] === undefined) delete riveConfig[key];
                });
                riveInstance = new rive.Rive(riveConfig);
                reportRenderSurfaceLoadStage('rive-constructed');
                window.riveInst = riveInstance;
                attachRiveUserEventListeners(rive, riveInstance);
            } catch (error) {
                reportRenderSurfaceLoadStage('construction-error', error && (error.message || error));
                showError('Error initializing Rive: ' + (error.message || error));
                logEvent('native', 'init-error', 'Error initializing runtime instance.');
            }
        }
        function normalizeStateMachineSelection(value) {
            if (!value) return [];
            if (typeof value === 'string') return [value];
            if (Array.isArray(value)) return value.filter(function (v) { return typeof v === 'string' && v; });
            return [];
        }
        function cleanupInstance() {
            clearRiveEventListeners();
            resetPlaybackChips();
            stopVmControlSync();
            clearVmControlBindings();
            if (isRenderSurfaceMode) {
                var bridgeState = getRenderSurfaceBridgeState();
                cleanupRenderSurfaceTopologySubscriptions(bridgeState);
                resetRenderSurfaceControlObserver(bridgeState);
                bridgeState.topologyTracker = null;
                bridgeState.topologyDirty = true;
            }
            vmListTopologySignature = null;
            pendingControlSnapshot.clear();
            if (riveInstance && riveInstance.cleanup) {
                try { riveInstance.cleanup(); } catch (e) { /* noop */ }
            }
            riveInstance = null;
            window.riveInst = null;
            loadedRiveRuntime = null;
        }
        /* ── Rive event listeners ────────────────────────────── */
        function clearRiveEventListeners() {
            riveEventUnsubscribers.forEach(function (unsub) {
                try { unsub(); } catch (e) { /* noop */ }
            });
            riveEventUnsubscribers = [];
        }
        function attachRiveUserEventListeners(runtime, instance) {
            clearRiveEventListeners();
            if (!runtime || !runtime.EventType || !instance || typeof instance.on !== 'function') return;
            var eventType = runtime.EventType.RiveEvent;
            if (!eventType) return;
            var listener = function (event) {
                var payload = (event && event.data) || event;
                var eventName = (payload && payload.name) || (event && event.name) || 'unknown';
                logEvent('rive-user', eventName, '', payload);
            };
            instance.on(eventType, listener);
            riveEventUnsubscribers.push(function () {
                if (typeof instance.off === 'function') {
                    instance.off(eventType, listener);
                }
            });
        }
        /* ── VM controls rendering orchestration ─────────────── */
        function renderVmControls() {
            if (isRenderingVmControls) return;
            var countEl = els.vmControlsCount;
            var emptyEl = els.vmControlsEmpty;
            var treeEl = els.vmControlsTree;
            if (!countEl || !emptyEl || !treeEl) return;
            isRenderingVmControls = true;
            try {
                treeEl.innerHTML = '';
                clearVmControlBindings();
                // Prefer the current runtime tree so converter-driven lists cannot go stale.
                var rootVm = resolveVmRootInstance();
                vmListTopologySignature = buildAllVmTopologySignature();
                var liveVmHierarchy = rootVm
                    ? buildVmHierarchy(rootVm)
                    : (VM_HIERARCHY && VM_HIERARCHY.label
                        ? JSON.parse(JSON.stringify(VM_HIERARCHY))
                        : null);
                var vmHierarchy = filterHierarchyNode(liveVmHierarchy);
                var globalVmHierarchies = getGlobalViewModelNames().map(function (name) {
                    var instance = resolveGlobalVmRootInstance(name);
                    return instance ? filterHierarchyNode(buildVmHierarchy(instance, name)) : null;
                }).filter(Boolean);
                var globalVmGroup = globalVmHierarchies.length ? {
                    children: globalVmHierarchies,
                    inputs: [],
                    kind: 'global-view-models',
                    label: 'Global VM',
                    path: '__global_view_models__',
                } : null;
                var stateMachineHierarchy = filterHierarchyNode(buildStateMachineHierarchy());
                var vmTotal = vmHierarchy ? countHierarchyInputs(vmHierarchy) : 0;
                var globalVmTotal = globalVmGroup ? countHierarchyInputs(globalVmGroup) : 0;
                var smTotal = stateMachineHierarchy ? countHierarchyInputs(stateMachineHierarchy) : 0;
                var totalControls = vmTotal + globalVmTotal + smTotal;
                countEl.textContent = String(totalControls);
                if (!totalControls && !globalVmGroup) {
                    emptyEl.hidden = false;
                    emptyEl.textContent = 'No writable ViewModel or state machine inputs were found.';
                    if (vmListTopologySignature === null && !pendingControlSnapshot.size) stopVmControlSync();
                    else startVmControlSync();
                    return;
                }
                emptyEl.hidden = totalControls > 0;
                if (!totalControls) emptyEl.textContent = 'No writable global ViewModel inputs were found.';
                if (globalVmGroup) treeEl.appendChild(createVmSectionElement(globalVmGroup, false, 0));
                // Filter out root-level VM inputs duplicated in child VMs.
                if (vmHierarchy && vmHierarchy.children && vmHierarchy.children.length && vmHierarchy.inputs) {
                    var childPaths = new Set();
                    var collectChildPaths = function (node) {
                        if (node.inputs) node.inputs.forEach(function (inp) { childPaths.add(inp.path); });
                        if (node.children) node.children.forEach(collectChildPaths);
                    };
                    vmHierarchy.children.forEach(collectChildPaths);
                    vmHierarchy.inputs = vmHierarchy.inputs.filter(function (inp) { return !childPaths.has(inp.path); });
                }
                if (vmHierarchy) treeEl.appendChild(createVmSectionElement(vmHierarchy, true, 0));
                if (stateMachineHierarchy && stateMachineHierarchy.totalInputs) {
                    treeEl.appendChild(createVmSectionElement(stateMachineHierarchy, false, 0));
                }
                startVmControlSync();
                syncVmControlBindings(true);
                initLucideIcons();
            } finally {
                isRenderingVmControls = false;
            }
        }
    })();
