        init();
        function init() {
            if (isRenderSurfaceMode) {
                document.body.classList.add('render-surface-mode');
                setupCanvasSize();
                setupCanvasResizeObserver();
                updateCanvasBackground();
                setupRenderSurfaceBridge();
                window.addEventListener('resize', handleResize);
                loadAnimation();
                return;
            }
            initLucideIcons();
            setupCanvasSize();
            setupCanvasResizeObserver();
            applyPersistedLayoutState();
            updateCanvasBackground();
            setupPlaybackControls();
            setupPanelResizers();
            setupCenterResizer();
            setupPanelVisibilityToggles();
            setupSettingsPopover();
            setupCopyInstantiationButton();
            setupLayoutSelect();
            setupAlignmentSelect();
            setupCanvasColor();
            setupEventLog();
            setupFullscreen();
            window.addEventListener('resize', handleResize);
            loadAnimation();
        }
        function renderSurfaceCommandPayload(command) {
            return command && command.payload && typeof command.payload === 'object'
                ? command.payload
                : command || {};
        }
        function setRenderSurfaceAccessorValue(accessor, kind, value) {
            if (!accessor) throw new Error('Control is unavailable.');
            if (kind === 'trigger') {
                if (typeof accessor.trigger === 'function') accessor.trigger();
                else if (typeof accessor.fire === 'function') accessor.fire();
                else throw new Error('Control is not a trigger.');
                return;
            }
            if (!('value' in accessor)) throw new Error('Control does not expose a value.');
            accessor.value = value;
        }
        function renderSurfaceCommandValue(payload, descriptor) {
            if (payload && Object.prototype.hasOwnProperty.call(payload, 'value')) {
                return payload.value;
            }
            return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
                ? descriptor.value
                : undefined;
        }
        function renderSurfaceImageCommand(payload) {
            var descriptor = payload && payload.descriptor && typeof payload.descriptor === 'object'
                ? payload.descriptor
                : payload || {};
            var command = Object.assign({}, descriptor);
            if (payload && Object.prototype.hasOwnProperty.call(payload, 'action')) command.action = payload.action;
            if (payload && Object.prototype.hasOwnProperty.call(payload, 'imageSelection')) command.imageSelection = payload.imageSelection;
            if (payload && Object.prototype.hasOwnProperty.call(payload, 'value')) command.value = payload.value;
            return command;
        }
        function resetRenderSurfaceAndWait(resetParams, resetSnapshot) {
            if (!riveInstance || typeof riveInstance.reset !== 'function') {
                return Promise.reject(new Error('Playback reset is unavailable.'));
            }
            if (pendingRenderSurfaceReset) {
                return Promise.reject(new Error('A playback reset is already in progress.'));
            }
            currentControlSnapshot = JSON.parse(JSON.stringify(resetSnapshot));
            return new Promise(function (resolve, reject) {
                var timeoutId = window.setTimeout(function () {
                    if (!pendingRenderSurfaceReset) return;
                    pendingControlSnapshot.clear();
                    if (typeof scheduleRenderSurfaceCanonicalRefresh === 'function') {
                        scheduleRenderSurfaceCanonicalRefresh('reset-first-frame', true);
                    }
                    pendingRenderSurfaceReset = null;
                    reject(new Error('Playback reset did not confirm a rendered frame.'));
                }, 8000);
                pendingRenderSurfaceReset = {
                    params: resetParams,
                    presentationScheduled: false,
                    reject: function (error) {
                        window.clearTimeout(timeoutId);
                        pendingRenderSurfaceReset = null;
                        reject(error);
                    },
                    resolve: function (result) {
                        window.clearTimeout(timeoutId);
                        pendingRenderSurfaceReset = null;
                        resolve(result);
                    },
                    snapshot: currentControlSnapshot,
                };
                try {
                    if (typeof invalidateRenderSurfaceCanonicalBindingsForReset === 'function') {
                        invalidateRenderSurfaceCanonicalBindingsForReset();
                    }
                    resetPlaybackChips();
                    riveInstance.reset(resetParams);
                    // `Rive.reset()` is in-place and is not required to call
                    // onLoad. Rebind an explicit VM here, after reset and
                    // before the scalar/list/image snapshots resolve. Zero is
                    // a valid list-instance key, so test only null/undefined.
                    var requestedVmInstanceKey = resetParams && resetParams.viewModelInstanceName;
                    var explicitVmInstanceRequested = requestedVmInstanceKey !== null
                        && typeof requestedVmInstanceKey !== 'undefined';
                    var bindingApplied = explicitVmInstanceRequested
                        ? bindViewModelInstanceByKey(riveInstance, requestedVmInstanceKey)
                        : true;
                    if (!bindingApplied) {
                        throw new Error('ViewModel instance "' + requestedVmInstanceKey + '" is unavailable after reset.');
                    }
                    pendingRenderSurfaceReset.binding = {
                        applied: bindingApplied,
                        key: explicitVmInstanceRequested ? requestedVmInstanceKey : null,
                        requested: explicitVmInstanceRequested,
                    };
                    // Rive reset is intentionally in-place: it normally does
                    // not re-enter onLoad. Start the child-only presentation
                    // barrier immediately after the reset call rather than
                    // recreating the renderer or waiting for a load callback.
                    settleRenderSurfaceResetAfterPresentation(pendingRenderSurfaceReset);
                } catch (error) {
                    if (typeof scheduleRenderSurfaceCanonicalRefresh === 'function') {
                        scheduleRenderSurfaceCanonicalRefresh('reset-first-frame', true);
                    }
                    pendingRenderSurfaceReset.reject(error);
                }
            });
        }
        function handleRenderSurfaceCommand(command, emitToMain) {
            if (command.sessionId && renderSurfaceSessionId && command.sessionId !== renderSurfaceSessionId) {
                return;
            }
            var type = String(command.type || command.command || '').toLowerCase();
            var payload = renderSurfaceCommandPayload(command);
            if (type === 'snapshot') {
                var snapshot = Array.isArray(payload.snapshot) ? payload.snapshot : (Array.isArray(command.snapshot) ? command.snapshot : []);
                var applied = applyControlSnapshot(snapshot);
                return { applied: applied, pending: pendingControlSnapshot.size };
            }
            if (type === 'vm-set' || type === 'vm-fire') {
                var vmDescriptor = payload.descriptor && typeof payload.descriptor === 'object' ? payload.descriptor : payload;
                var vmKind = type === 'vm-fire' ? 'trigger' : vmDescriptor.kind;
                var vmAccessor = resolveLiveAccessor(vmDescriptor.path, vmKind);
                if (vmKind === 'trigger' && riveInstance && riveInstance.isPlaying === false) riveInstance.play();
                setRenderSurfaceAccessorValue(vmAccessor, vmKind, renderSurfaceCommandValue(payload, vmDescriptor));
                if (vmKind === 'trigger') recordRenderSurfaceTriggerReceipt(Object.assign({}, vmDescriptor, { kind: 'trigger', source: 'view-model' }));
                return {
                    descriptor: vmDescriptor,
                    value: vmKind === 'trigger' ? null : vmAccessor.value,
                };
            }
            if (type === 'vm-image-set') {
                var imageDescriptor = renderSurfaceImageCommand(payload);
                return applyRenderSurfaceImageCommand(imageDescriptor, true);
            }
            if (type === 'sm-set' || type === 'sm-fire') {
                var smDescriptor = payload.descriptor && typeof payload.descriptor === 'object' ? payload.descriptor : payload;
                var smKind = type === 'sm-fire' ? 'trigger' : smDescriptor.kind;
                var smAccessor = resolveStateMachineInputAccessor(smDescriptor.stateMachineName, smDescriptor.name, smKind);
                if (smKind === 'trigger' && riveInstance && riveInstance.isPlaying === false) riveInstance.play();
                setRenderSurfaceAccessorValue(smAccessor, smKind, renderSurfaceCommandValue(payload, smDescriptor));
                if (smKind === 'trigger') recordRenderSurfaceTriggerReceipt(Object.assign({}, smDescriptor, { kind: 'trigger', source: 'state-machine' }));
                return {
                    descriptor: smDescriptor,
                    value: smKind === 'trigger' ? null : smAccessor.value,
                };
            }
            if (type === 'play') {
                if (!riveInstance || typeof riveInstance.play !== 'function') throw new Error('Playback is unavailable.');
                var playTarget = payload.name || payload.animation || payload.playbackName;
                var configuredTarget = window.__ravRenderSurfaceTarget || {};
                if (!playTarget && configuredTarget.type === 'animation') playTarget = configuredTarget.name;
                if (playTarget) riveInstance.play(playTarget);
                else riveInstance.play();
                return { name: playTarget || null };
            }
            if (type === 'pause') {
                if (!riveInstance || typeof riveInstance.pause !== 'function') throw new Error('Playback pause is unavailable.');
                riveInstance.pause();
                return { paused: true };
            }
            if (type === 'reset') {
                var resetSnapshot = Array.isArray(payload.snapshot) ? payload.snapshot : [];
                var resetContract = buildRenderSurfaceResetContract(payload.params);
                var resetParams = resetContract.params;
                currentControlSnapshot = JSON.parse(JSON.stringify(resetSnapshot));
                setRenderSurfacePlaybackTarget(resetContract.target);
                return resetRenderSurfaceAndWait(resetParams, resetSnapshot);
            }
            if (type === 'presentation') {
                applyRenderSurfacePresentation(payload);
                return { presentation: true };
            }
            if (type === 'resize') {
                handleResize();
                return { resized: true };
            }
            if (type === 'prepare-frame') {
                // A child may be staged behind the active surface. Wait for two
                // presentation opportunities after all snapshot/layout work so
                // the host swaps only after a composited candidate is ready.
                return waitForRenderSurfacePresentationFrames(2);
            }
            if (type === 'activate-callbacks') {
                return { activated: activateRenderSurfaceUserCallbacks() };
            }
            throw new Error('Unsupported render-surface command: ' + (type || '(empty)'));
        }
        function applyRenderSurfacePresentation(payload) {
            if (LAYOUT_FITS.indexOf(payload.layoutFit) >= 0) currentLayoutFit = payload.layoutFit;
            if (LAYOUT_ALIGNMENTS.indexOf(payload.layoutAlignment) >= 0) currentLayoutAlignment = payload.layoutAlignment;
            if (payload.canvasSizing && typeof payload.canvasSizing === 'object') {
                currentCanvasSizing = normalizeCanvasSizingState(payload.canvasSizing, currentCanvasSizing);
            }
            if (payload.canvasTransparent === true) {
                currentCanvasColor = TRANSPARENT_CANVAS_COLOR;
            } else {
                var solidColor = normalizeCanvasColor(payload.canvasColor);
                if (solidColor) {
                    lastSolidCanvasColor = solidColor;
                    currentCanvasColor = solidColor;
                }
            }
            updateCanvasBackground();
            syncCanvasColorControls();
            if (riveInstance && loadedRiveRuntime && loadedRiveRuntime.Layout) {
                var nextLayout = {
                    fit: resolveRiveLayoutFit(loadedRiveRuntime, currentLayoutFit),
                    alignment: resolveRiveLayoutAlignment(loadedRiveRuntime, currentLayoutAlignment),
                };
                riveInstance.layout = typeof riveInstance.layout?.copyWith === 'function'
                    ? riveInstance.layout.copyWith(nextLayout)
                    : new loadedRiveRuntime.Layout(nextLayout);
            }
            handleResize();
        }
        function parseCssPixels(value, fallback) {
            var numeric = Number.parseFloat(String(value == null ? '' : value).replace('px', '').trim());
            return Number.isFinite(numeric) ? Math.round(numeric) : fallback;
        }
        function normalizeCanvasColor(rawColor) {
            var value = String(rawColor || '').trim().toLowerCase();
            if (/^#[0-9a-f]{6}$/i.test(value)) {
                return value;
            }
            return null;
        }
        function isCanvasBackgroundTransparent() {
            return currentCanvasColor === TRANSPARENT_CANVAS_COLOR;
        }
        function syncCanvasColorControls() {
            var input = els.canvasColorInput;
            var resetBtn = els.canvasColorResetBtn;
            if (!input || !resetBtn) return;
            if (!normalizeCanvasColor(lastSolidCanvasColor)) {
                lastSolidCanvasColor = DEFAULT_CANVAS_COLOR;
            }
            input.value = lastSolidCanvasColor;
            input.classList.toggle('is-transparent', isCanvasBackgroundTransparent());
            resetBtn.classList.toggle('is-active', isCanvasBackgroundTransparent());
            resetBtn.setAttribute('aria-pressed', String(isCanvasBackgroundTransparent()));
        }
        function applyPersistedLayoutState() {
            var rightWidth = parseCssPixels(LAYOUT_STATE.rightPanelWidth, 320);
            var eventLogHeight = parseCssPixels(LAYOUT_STATE.eventLogHeight, 230);
            var collapsedEventLog = Boolean(LAYOUT_STATE.eventLogCollapsed);
            if (els.mainGrid && Number.isFinite(rightWidth)) {
                els.mainGrid.style.setProperty('--right-width', clamp(rightWidth, 260, 900) + 'px');
            }
            if (els.centerPanel && Number.isFinite(eventLogHeight)) {
                els.centerPanel.style.setProperty('--center-log-height', clamp(eventLogHeight, 120, 420) + 'px');
            }
            if (typeof setEventLogCollapsed === 'function') {
                setEventLogCollapsed(collapsedEventLog);
            }
            syncCanvasColorControls();
        }
        function initLucideIcons() {
            if (typeof lucide !== 'undefined' && lucide.createIcons) {
                lucide.createIcons();
            }
        }
        /* ── Canvas sizing ───────────────────────────────────── */

        function setupCanvasSize() {
            resizeCanvas();
        }

        function setupCanvasResizeObserver() {
            if (!els.canvasContainer || typeof ResizeObserver === 'undefined') return;
            if (canvasResizeObserver) {
                try { canvasResizeObserver.disconnect(); } catch (e) { /* noop */ }
            }
            canvasResizeObserver = new ResizeObserver(function () {
                handleResize();
            });
            canvasResizeObserver.observe(els.canvasContainer);
        }

        function resizeCanvas() {
            const container = els.canvasContainer;
            const canvas = els.canvas;
            if (!container || !canvas) return;
            const dpr = window.devicePixelRatio || 1;
            const sizing = normalizeCanvasSizingState(currentCanvasSizing, DEFAULT_CANVAS_SIZING);
            const isFixed = sizing.mode === 'fixed';
            const { clientWidth, clientHeight } = container;
            const pixelWidth = isFixed ? sizing.width : clientWidth;
            const pixelHeight = isFixed ? sizing.height : clientHeight;
            container.classList.toggle('canvas-container-fixed-size', isFixed);
            canvas.classList.toggle('rive-canvas-fixed-size', isFixed);
            canvas.width = pixelWidth * dpr;
            canvas.height = pixelHeight * dpr;
            canvas.style.width = pixelWidth + 'px';
            canvas.style.height = pixelHeight + 'px';
            scheduleCanvasViewportAlignment(container, {
                fixed: isFixed,
                width: pixelWidth,
                height: pixelHeight,
            });
        }

        function buildCenteredCanvasScrollOffsets(containerWidth, containerHeight, contentWidth, contentHeight) {
            return {
                left: Math.max(0, Math.round((contentWidth - containerWidth) / 2)),
                top: Math.max(0, Math.round((contentHeight - containerHeight) / 2)),
            };
        }

        function scheduleCanvasViewportAlignment(container, canvasSize) {
            var scheduler = typeof window.requestAnimationFrame === 'function'
                ? window.requestAnimationFrame.bind(window)
                : function (callback) { callback(); };
            scheduler(function () {
                if (!canvasSize || !canvasSize.fixed) {
                    container.scrollLeft = 0;
                    container.scrollTop = 0;
                    return;
                }
                var offsets = buildCenteredCanvasScrollOffsets(
                    container.clientWidth,
                    container.clientHeight,
                    canvasSize.width,
                    canvasSize.height
                );
                container.scrollLeft = offsets.left;
                container.scrollTop = offsets.top;
            });
        }

        function handleResize() {
            resizeCanvas();
            if (riveInstance) {
                riveInstance.resizeDrawingSurfaceToCanvas();
            }
        }

        /* ── Canvas background ───────────────────────────────── */
        function updateCanvasBackground() {
            var canvasBackground = isCanvasBackgroundTransparent() ? 'transparent' : currentCanvasColor;
            document.documentElement.style.setProperty('--canvas-color', canvasBackground);

            if (els.canvasContainer) {
                els.canvasContainer.style.background = canvasBackground;
            }
            if (els.canvas) {
                els.canvas.style.background = canvasBackground;
            }

            var themeColorMeta = document.querySelector('meta[name="theme-color"]');
            if (themeColorMeta) {
                themeColorMeta.setAttribute('content', normalizeCanvasColor(currentCanvasColor) || DEFAULT_CANVAS_COLOR);
            }
        }
