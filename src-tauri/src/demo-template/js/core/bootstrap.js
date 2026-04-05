        init();

        function init() {
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
            setupTransparencyControls();
            setupEventLog();
            setupFullscreen();
            window.addEventListener('resize', handleResize);
            loadAnimation();
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

        function isCanvasEffectivelyTransparent() {
            return isTransparencyModeEnabled || isCanvasBackgroundTransparent();
        }

        function updateSettingToggle(button, active) {
            if (!button) return;
            button.classList.toggle('is-active', active);
            button.setAttribute('aria-pressed', String(active));
            button.textContent = active ? 'ON' : 'OFF';
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

        function syncTransparencyControls() {
            updateSettingToggle(els.transparencyModeToggle, isTransparencyModeEnabled);
            if (els.transparencyModeToggle) {
                els.transparencyModeToggle.disabled = !DEMO_TRANSPARENCY_TOGGLE_ENABLED;
                els.transparencyModeToggle.setAttribute('aria-disabled', String(!DEMO_TRANSPARENCY_TOGGLE_ENABLED));
                els.transparencyModeToggle.title = DEMO_TRANSPARENCY_TOGGLE_ENABLED
                    ? 'Toggle transparency mode'
                    : 'Transparency mode is not available in exported demos';
            }
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

            document.documentElement.classList.toggle('transparency-mode', isTransparencyModeEnabled);
            document.body.classList.toggle('transparency-mode', isTransparencyModeEnabled);
            syncCanvasColorControls();
            syncTransparencyControls();
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
            var canvasBackground = isCanvasEffectivelyTransparent() ? 'transparent' : currentCanvasColor;
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
