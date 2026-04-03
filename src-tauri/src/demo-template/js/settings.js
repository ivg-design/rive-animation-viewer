        function setupSettingsPopover() {
            const btn = els.settingsBtn;
            const popover = els.settingsPopover;
            if (!btn || !popover) return;

            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                popover.hidden = !popover.hidden;
            });

            document.addEventListener('click', function (e) {
                if (!popover.hidden && !popover.contains(e.target) && e.target !== btn) {
                    popover.hidden = true;
                }
            });

            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && !popover.hidden) {
                    popover.hidden = true;
                }
            });
        }

        function setupCopyInstantiationButton() {
            var button = els.copyInstantiationBtn;
            var sourceSelect = els.instantiationPackageSourceSelect;
            if (!button) {
                return;
            }

            var resolveSnippet = function () {
                var currentSnippet = INSTANTIATION_SNIPPETS[currentInstantiationPackageSource];
                if (typeof currentSnippet === 'string' && currentSnippet.trim()) {
                    return currentSnippet.trim();
                }
                var fallback = String(CONFIG.instantiationCode || '').trim();
                return fallback;
            };

            if (sourceSelect) {
                var hasLocalSnippet = typeof INSTANTIATION_SNIPPETS.local === 'string' && INSTANTIATION_SNIPPETS.local.trim();
                var hasCdnSnippet = typeof INSTANTIATION_SNIPPETS.cdn === 'string' && INSTANTIATION_SNIPPETS.cdn.trim();
                sourceSelect.hidden = !(hasLocalSnippet || hasCdnSnippet);
                sourceSelect.value = currentInstantiationPackageSource;
                sourceSelect.addEventListener('change', function () {
                    currentInstantiationPackageSource = sourceSelect.value === 'local' ? 'local' : 'cdn';
                });
            }

            if (!resolveSnippet()) {
                if (button) {
                    button.hidden = true;
                }
                return;
            }

            button.hidden = false;
            button.title = 'Copy web instantiation code';
            button.addEventListener('click', function () {
                var resetLabel = function () {
                    button.textContent = 'COPY CODE';
                };

                if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
                    logEvent('ui', 'copy-instantiation-failed', 'Clipboard API unavailable in exported demo.');
                    return;
                }

                navigator.clipboard.writeText(resolveSnippet()).then(function () {
                    button.textContent = 'COPIED';
                    logEvent('ui', 'copy-instantiation', 'Copied ' + currentInstantiationPackageSource + ' web instantiation code.');
                    setTimeout(resetLabel, 1600);
                }).catch(function (error) {
                    logEvent('ui', 'copy-instantiation-failed', 'Failed to copy web instantiation code.', error);
                });
            });
        }

        /* ── Layout fit select ───────────────────────────────── */

        function setupLayoutSelect() {
            const select = els.layoutSelect;
            if (!select) return;
            select.value = currentLayoutFit;

            select.addEventListener('change', function () {
                const selected = select.value;
                if (!selected || selected === currentLayoutFit) return;
                if (!LAYOUT_FITS.includes(selected)) return;
                currentControlSnapshot = captureVmControlSnapshot();
                currentLayoutFit = selected;
                logEvent('ui', 'layout-change', 'Layout fit set to ' + currentLayoutFit);
                // Reload to apply new layout
                loadAnimation();
            });
        }

        function setupAlignmentSelect() {
            const select = els.alignmentSelect;
            if (!select) return;
            select.value = currentLayoutAlignment;

            select.addEventListener('change', function () {
                const selected = select.value;
                if (!selected || selected === currentLayoutAlignment) return;
                if (!LAYOUT_ALIGNMENTS.includes(selected)) return;
                currentControlSnapshot = captureVmControlSnapshot();
                currentLayoutAlignment = selected;
                logEvent('ui', 'alignment-change', 'Layout alignment set to ' + currentLayoutAlignment);
                loadAnimation();
            });
        }

        /* ── Canvas color input ──────────────────────────────── */

        function setupCanvasColor() {
            const input = els.canvasColorInput;
            const resetBtn = els.canvasColorResetBtn;
            if (!input || !resetBtn) return;

            syncCanvasColorControls();
            input.addEventListener('input', function () {
                var normalized = normalizeCanvasColor(input.value);
                if (!normalized) return;
                lastSolidCanvasColor = normalized;
                currentCanvasColor = normalized;
                syncCanvasColorControls();
                updateCanvasBackground();
                logEvent('ui', 'canvas-color', 'Canvas color changed to ' + currentCanvasColor);
            });

            resetBtn.addEventListener('click', function () {
                currentCanvasColor = TRANSPARENT_CANVAS_COLOR;
                syncCanvasColorControls();
                updateCanvasBackground();
                logEvent('ui', 'canvas-color', 'Canvas background reset to transparent.');
            });
        }

        function setupTransparencyControls() {
            var toggle = els.transparencyModeToggle;
            if (!toggle) return;

            isTransparencyModeEnabled = false;
            syncTransparencyControls();
            document.documentElement.classList.toggle('transparency-mode', isTransparencyModeEnabled);
            document.body.classList.toggle('transparency-mode', isTransparencyModeEnabled);
            if (!DEMO_TRANSPARENCY_TOGGLE_ENABLED) {
                return;
            }
            toggle.addEventListener('click', function () {
                isTransparencyModeEnabled = !isTransparencyModeEnabled;
                document.documentElement.classList.toggle('transparency-mode', isTransparencyModeEnabled);
                document.body.classList.toggle('transparency-mode', isTransparencyModeEnabled);
                syncTransparencyControls();
                updateCanvasBackground();
                logEvent('ui', 'transparency-mode', 'Transparency mode ' + (isTransparencyModeEnabled ? 'enabled' : 'disabled') + '.');
            });
        }

        /* ── Fullscreen ──────────────────────────────────────── */
