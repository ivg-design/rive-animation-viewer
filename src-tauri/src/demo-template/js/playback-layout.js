        function setupPlaybackControls() {
            if (els.btnPlay) els.btnPlay.addEventListener('click', play);
            if (els.btnPause) els.btnPause.addEventListener('click', pause);
            if (els.btnReset) els.btnReset.addEventListener('click', resetAnimation);
        }

        function play() {
            if (riveInstance) {
                riveInstance.play();
                updateInfo('Playing');
                logEvent('ui', 'play', 'Playback started from UI.');
            }
        }

        function pause() {
            if (riveInstance) {
                riveInstance.pause();
                updateInfo('Paused');
                logEvent('ui', 'pause', 'Playback paused from UI.');
            }
        }

        function resetAnimation() {
            if (riveInstance) {
                riveInstance.reset();
                resetPlaybackChips();
                updateInfo('Reset');
                logEvent('ui', 'reset', 'Animation reset from UI.');
            }
        }

        /* ── Panel resize/collapse controls ─────────────────── */

        function setupPanelResizers() {
            var grid = els.mainGrid;
            var rightResizer = els.rightResizer;
            if (!grid || !rightResizer) return;

            rightResizer.addEventListener('mousedown', function (event) {
                if (!isRightPanelVisible) return;
                event.preventDefault();
                var gridRect = grid.getBoundingClientRect();
                var startX = event.clientX;
                var initialRight = grid.style.getPropertyValue('--right-width')
                    ? parseFloat(grid.style.getPropertyValue('--right-width'))
                    : (els.rightPanel ? els.rightPanel.offsetWidth : 320);

                rightResizer.classList.add('is-dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';

                var onMove = function (moveEvent) {
                    var deltaX = moveEvent.clientX - startX;
                    var maxRight = Math.max(300, gridRect.width - 320);
                    var nextRight = clamp(initialRight - deltaX, 260, maxRight);
                    grid.style.setProperty('--right-width', Math.round(nextRight) + 'px');
                    handleResize();
                };

                var onUp = function () {
                    rightResizer.classList.remove('is-dragging');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    handleResize();
                };

                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            });
        }

        function setupCenterResizer() {
            var centerPanel = els.centerPanel;
            var centerResizer = els.centerResizer;
            if (!centerPanel || !centerResizer) return;

            centerResizer.addEventListener('mousedown', function (event) {
                event.preventDefault();
                var startY = event.clientY;
                var startHeight = centerPanel.style.getPropertyValue('--center-log-height')
                    ? parseFloat(centerPanel.style.getPropertyValue('--center-log-height'))
                    : 230;

                centerResizer.classList.add('is-dragging');
                document.body.style.cursor = 'row-resize';
                document.body.style.userSelect = 'none';

                var onMove = function (moveEvent) {
                    var deltaY = moveEvent.clientY - startY;
                    var nextHeight = clamp(startHeight - deltaY, 120, 420);
                    centerPanel.style.setProperty('--center-log-height', Math.round(nextHeight) + 'px');
                    handleResize();
                };

                var onUp = function () {
                    centerResizer.classList.remove('is-dragging');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                    handleResize();
                };

                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
            });
        }

        function setupPanelVisibilityToggles() {
            var grid = els.mainGrid;
            var toggleBtn = els.toggleRightPanelBtn;
            var showBtn = els.showRightPanelBtn;
            if (!grid || !toggleBtn || !showBtn) return;

            var applyVisibility = function () {
                grid.classList.toggle('right-hidden', !isRightPanelVisible);
                toggleBtn.classList.toggle('is-collapsed', !isRightPanelVisible);
                toggleBtn.setAttribute('aria-pressed', String(isRightPanelVisible));
                toggleBtn.title = isRightPanelVisible ? 'Hide Properties Panel' : 'Show Properties Panel';
                toggleBtn.setAttribute('aria-label', toggleBtn.title);
                showBtn.hidden = isRightPanelVisible;
                handleResize();
                setTimeout(handleResize, 250);
            };

            toggleBtn.addEventListener('click', function () {
                isRightPanelVisible = !isRightPanelVisible;
                applyVisibility();
            });

            showBtn.addEventListener('click', function () {
                isRightPanelVisible = true;
                applyVisibility();
            });

            applyVisibility();
        }

        /* ── FPS tracking ────────────────────────────────────── */

        function updatePlaybackChips() {
            frameCount += 1;
            const now = performance.now();
            if (now - lastFpsUpdate >= 1000) {
                const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
                if (els.fpsChip) {
                    els.fpsChip.innerHTML = '<span class="dot"></span>' + fps + ' FPS';
                }
                frameCount = 0;
                lastFpsUpdate = now;
            }
        }

        function resetPlaybackChips() {
            frameCount = 0;
            lastFpsUpdate = performance.now();
            if (els.fpsChip) els.fpsChip.innerHTML = '<span class="dot"></span>-- FPS';
        }

        /* ── Settings popover ────────────────────────────────── */
