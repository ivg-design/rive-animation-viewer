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

        function setupRenderSurfaceBridge() {
            var events = window.__TAURI__ && window.__TAURI__.event;
            if (!events || typeof events.listen !== 'function') return;

            var emitToMain = function (eventName, payload) {
                if (typeof events.emitTo !== 'function') return;
                var eventPayload = Object.assign(
                    { sessionId: renderSurfaceSessionId },
                    payload && typeof payload === 'object' ? payload : {},
                );
                Promise.resolve(events.emitTo('main', eventName, eventPayload)).catch(function () { /* noop */ });
            };
            window.__ravRenderSurfaceEmit = emitToMain;

            events.listen('render-surface:command', function (event) {
                var command = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
                try {
                    handleRenderSurfaceCommand(command, emitToMain);
                } catch (error) {
                    emitToMain('render-surface:error', {
                        command: command.type || command.command || null,
                        message: String((error && error.message) || error),
                    });
                }
            }).catch(function (error) {
                emitToMain('render-surface:error', { phase: 'listen', message: String((error && error.message) || error) });
            });

            emitToMain('render-surface:ready', { protocol: 1 });
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

        function handleRenderSurfaceCommand(command, emitToMain) {
            if (command.sessionId && renderSurfaceSessionId && command.sessionId !== renderSurfaceSessionId) {
                return;
            }
            var type = String(command.type || command.command || '').toLowerCase();
            var payload = renderSurfaceCommandPayload(command);
            if (type === 'snapshot') {
                var snapshot = Array.isArray(payload.snapshot) ? payload.snapshot : (Array.isArray(command.snapshot) ? command.snapshot : []);
                var applied = applyControlSnapshot(snapshot);
                emitToMain('render-surface:loaded', { command: 'snapshot', applied: applied });
                return;
            }
            if (type === 'vm-set' || type === 'vm-fire') {
                var vmDescriptor = payload.descriptor && typeof payload.descriptor === 'object' ? payload.descriptor : payload;
                var vmKind = type === 'vm-fire' ? 'trigger' : vmDescriptor.kind;
                var vmAccessor = resolveLiveAccessor(vmDescriptor.path, vmKind);
                setRenderSurfaceAccessorValue(vmAccessor, vmKind, vmDescriptor.value);
                return;
            }
            if (type === 'sm-set' || type === 'sm-fire') {
                var smDescriptor = payload.descriptor && typeof payload.descriptor === 'object' ? payload.descriptor : payload;
                var smKind = type === 'sm-fire' ? 'trigger' : smDescriptor.kind;
                var smAccessor = resolveStateMachineInputAccessor(smDescriptor.stateMachineName, smDescriptor.name, smKind);
                setRenderSurfaceAccessorValue(smAccessor, smKind, smDescriptor.value);
                return;
            }
            if (type === 'play') {
                if (riveInstance && typeof riveInstance.play === 'function') riveInstance.play();
                return;
            }
            if (type === 'pause') {
                if (riveInstance && typeof riveInstance.pause === 'function') riveInstance.pause();
                return;
            }
            if (type === 'reset') {
                if (riveInstance && typeof riveInstance.reset === 'function') riveInstance.reset();
                return;
            }
            if (type === 'resize') {
                handleResize();
                return;
            }
            throw new Error('Unsupported render-surface command: ' + (type || '(empty)'));
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
