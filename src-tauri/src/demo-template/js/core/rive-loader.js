        function clamp(value, min, max) {
            return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
        }

        function argbToColorMeta(value) {
            var rawValue = Number.isFinite(Number(value)) ? Number(value) >>> 0 : 0xff000000;
            var alpha = (rawValue >>> 24) & 255;
            var red = (rawValue >>> 16) & 255;
            var green = (rawValue >>> 8) & 255;
            var blue = rawValue & 255;
            return {
                hex: '#' + toHexByte(red) + toHexByte(green) + toHexByte(blue),
                alphaPercent: Math.round((alpha / 255) * 100),
            };
        }

        function toHexByte(value) {
            return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
        }

        function hexToRgb(hex) {
            var cleanHex = String(hex || '').trim().replace('#', '');
            if (!/^[0-9a-fA-F]{6}$/.test(cleanHex)) return { r: 0, g: 0, b: 0 };
            return {
                r: parseInt(cleanHex.slice(0, 2), 16),
                g: parseInt(cleanHex.slice(2, 4), 16),
                b: parseInt(cleanHex.slice(4, 6), 16),
            };
        }

        function rgbAlphaToArgb(red, green, blue, alpha) {
            return (
                ((clamp(alpha, 0, 255) & 255) << 24) |
                ((clamp(red, 0, 255) & 255) << 16) |
                ((clamp(green, 0, 255) & 255) << 8) |
                (clamp(blue, 0, 255) & 255)
            ) >>> 0;
        }

        /* ── Rive animation loading ──────────────────────────── */

        function loadAnimation() {
            if (!els.canvas || !els.canvasContainer) {
                showError('Canvas element not found.');
                return;
            }

            updateInfo('Loading animation...');
            logEvent('native', 'load-start', 'Loading embedded animation.');

            try {
                // Locate the Rive constructor from the runtime
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

                // Clean up previous instance
                cleanupInstance();

                // Decode embedded animation from base64
                var base64Data = CONFIG.animationBase64;
                var binaryString = atob(base64Data);
                var bytes = new Uint8Array(binaryString.length);
                for (var i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                var animationBlob = new Blob([bytes], { type: 'application/octet-stream' });
                var animationUrl = URL.createObjectURL(animationBlob);

                resizeCanvas();

                // Build Rive config
                var configuredStateMachines = normalizeStateMachineSelection(CONFIG.stateMachines);
                var userSpecifiedStateMachines = configuredStateMachines.length > 0;
                var didRestartForStateMachine = false;

                var riveConfig = {
                    src: animationUrl,
                    canvas: els.canvas,
                    autoplay: CONFIG.autoplay !== false,
                    autoBind: true,
                };

                if (CONFIG.artboardName) {
                    riveConfig.artboard = CONFIG.artboardName;
                }

                if (userSpecifiedStateMachines) {
                    riveConfig.stateMachines = configuredStateMachines.length === 1
                        ? configuredStateMachines[0]
                        : configuredStateMachines;
                }

                // Set layout
                if (rive.Layout) {
                    riveConfig.layout = new rive.Layout({
                        fit: resolveRiveLayoutFit(rive, currentLayoutFit),
                        alignment: resolveRiveLayoutAlignment(rive, currentLayoutAlignment),
                    });
                }
                if (isCanvasEffectivelyTransparent() && CONFIG.runtimeName !== 'canvas' && typeof riveConfig.useOffscreenRenderer === 'undefined') {
                    riveConfig.useOffscreenRenderer = true;
                }

                riveConfig.onLoad = function () {
                    // Auto-detect state machine if none specified
                    if (!didRestartForStateMachine && !userSpecifiedStateMachines) {
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
                            riveConfig.stateMachines = detectedSmName;
                            riveInstance = new rive.Rive(riveConfig);
                            window.riveInst = riveInstance;
                            attachRiveUserEventListeners(rive, riveInstance);
                            return;
                        }
                    }

                    hideError();
                    resizeCanvas();
                    if (riveInstance) riveInstance.resizeDrawingSurfaceToCanvas();

                    var smNames = Array.isArray(riveInstance && riveInstance.stateMachineNames) ? riveInstance.stateMachineNames : [];
                    var activeStateMachine = 'none';
                    if (riveConfig.stateMachines) {
                        activeStateMachine = Array.isArray(riveConfig.stateMachines)
                            ? riveConfig.stateMachines[0]
                            : riveConfig.stateMachines;
                    } else if (smNames.length > 0) {
                        activeStateMachine = smNames[0];
                    }

                    var statusMsg = smNames.length > 0
                        ? 'Loaded - state machine "' + activeStateMachine + '" active'
                        : 'Loaded - no state machines';
                    updateInfo(statusMsg);
                    logEvent('native', 'load', 'Animation loaded successfully.');

                    applyControlSnapshot(currentControlSnapshot);
                    // Render VM controls
                    renderVmControls();
                };

                riveConfig.onLoadError = function (error) {
                    var errorMsg = (error && error.message) || String(error);
                    showError('Error loading animation: ' + errorMsg);
                    logEvent('native', 'loaderror', 'Load error: ' + errorMsg);
                };

                riveConfig.onPlay = function (event) {
                    logEvent('native', 'play', 'Playback started by runtime.', event);
                };

                riveConfig.onPause = function (event) {
                    logEvent('native', 'pause', 'Playback paused by runtime.', event);
                };

                riveConfig.onStop = function (event) {
                    logEvent('native', 'stop', 'Playback stopped by runtime.', event);
                };

                riveConfig.onLoop = function (event) {
                    logEvent('native', 'loop', 'Loop event emitted by runtime.', event);
                };

                riveConfig.onStateChange = function (event) {
                    logEvent('native', 'statechange', 'State machine changed state.', event);
                };

                riveConfig.onAdvance = function (event) {
                    updatePlaybackChips();
                };

                // Remove undefined keys
                Object.keys(riveConfig).forEach(function (key) {
                    if (riveConfig[key] === undefined) delete riveConfig[key];
                });

                riveInstance = new rive.Rive(riveConfig);
                window.riveInst = riveInstance;
                attachRiveUserEventListeners(rive, riveInstance);

            } catch (error) {
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
            if (riveInstance && riveInstance.cleanup) {
                try { riveInstance.cleanup(); } catch (e) { /* noop */ }
            }
            riveInstance = null;
            window.riveInst = null;
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
            var countEl = els.vmControlsCount;
            var emptyEl = els.vmControlsEmpty;
            var treeEl = els.vmControlsTree;
            if (!countEl || !emptyEl || !treeEl) return;

            treeEl.innerHTML = '';
            clearVmControlBindings();

            // Use embedded hierarchy if available, otherwise fall back to dynamic discovery.
            var vmHierarchy = null;
            if (VM_HIERARCHY && VM_HIERARCHY.label) {
                vmHierarchy = filterHierarchyNode(JSON.parse(JSON.stringify(VM_HIERARCHY)));
            } else {
                var rootVm = resolveVmRootInstance();
                vmHierarchy = rootVm ? buildVmHierarchy(rootVm) : null;
            }

            var stateMachineHierarchy = buildStateMachineHierarchy();
            var vmTotal = vmHierarchy ? countHierarchyInputs(vmHierarchy) : 0;
            var smTotal = stateMachineHierarchy ? countHierarchyInputs(stateMachineHierarchy) : 0;
            var totalControls = vmTotal + smTotal;

            countEl.textContent = String(totalControls);

            if (!totalControls) {
                emptyEl.hidden = false;
                emptyEl.textContent = 'No writable ViewModel or state machine inputs were found.';
                stopVmControlSync();
                return;
            }

            emptyEl.hidden = true;

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

            if (vmHierarchy) {
                treeEl.appendChild(createVmSectionElement(vmHierarchy, true, 0));
            }
            if (stateMachineHierarchy && stateMachineHierarchy.totalInputs) {
                treeEl.appendChild(createVmSectionElement(stateMachineHierarchy, false, 0));
            }

            startVmControlSync();
            syncVmControlBindings(true);
            initLucideIcons();
        }

    })();
