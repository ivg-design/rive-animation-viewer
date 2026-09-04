        // Explicit advancement must not depend on WKWebView's visibility-gated RAF.
        // This adapter is version/capability checked: it uses the runtime's own
        // advance/draw/flush ordering rather than reimplementing GPU rendering.
        function renderSurfaceAdvanceFrame(player, seconds) {
            if (!player || !player.loaded || !player.artboard || typeof player.draw !== 'function'
                || typeof player.stopRendering !== 'function') {
                throw new Error('This runtime cannot render an explicit frame.');
            }
            if (player._hasZeroSize) throw new Error('Cannot render a zero-size canvas.');
            if (!Number.isFinite(seconds) || seconds < 0 || seconds > 1) {
                throw new Error('Frame duration must be between zero and one second.');
            }
            var optimization = player.drawOptimization;
            var now = Math.max(1001, performance.now());
            player.stopRendering();
            try {
                player.lastRenderTime = now - seconds * 1000;
                player.drawOptimization = 'alwaysDraw';
                player.draw(now);
                if (player.runtime && typeof player.runtime.resolveAnimationFrame === 'function') {
                    player.runtime.resolveAnimationFrame();
                }
                return { advancedSeconds: seconds, rendered: true, frame: player.frameCount };
            } finally {
                player.stopRendering();
                player.drawOptimization = optimization;
            }
        }

        function setupRenderSurfaceFrameClock(player) {
            if (!isRenderSurfaceMode || !player || player.__ravClockInstalled) return;
            player.__ravClockInstalled = true;
            var clock = { lastDraw: performance.now(), fallback: false, inside: false };
            var original = player._boundDraw;
            if (typeof original !== 'function') throw new Error('Runtime frame callbacks are unavailable.');
            player._boundDraw = function () {
                if (typeof pumpRenderSurfaceRecording === 'function' && pumpRenderSurfaceRecording()) return;
                var args = Array.prototype.slice.call(arguments);
                var stale = Number(args[0]) < Number(player.lastRenderTime);
                if (stale) args[0] = player.lastRenderTime;
                if (typeof advanceMediaRecordingInteractions === 'function') advanceMediaRecordingInteractions();
                var result = original.apply(player, args);
                if (!stale) {
                    clock.lastDraw = performance.now();
                    clock.fallback = false;
                }
                if (player.runtime && player.runtime.resolveAnimationFrame) player.runtime.resolveAnimationFrame();
                recordRenderSurfaceMediaFrame();
                return result;
            };
            // Native ticks continue when the OS suppresses the child RAF queue.
            // No wall-time catch-up is applied after a pause or explicit step.
            window.__ravNativeFrameTick = function () {
                if (typeof pumpRenderSurfaceRecording === 'function' && pumpRenderSurfaceRecording()) return;
                if (riveInstance !== player || clock.inside || !player.isPlaying) {
                    clock.lastDraw = performance.now();
                    if (riveInstance === player && !clock.inside) {
                        if (typeof advanceMediaRecordingInteractions === 'function' && advanceMediaRecordingInteractions()) renderSurfaceAdvanceFrame(player, 0);
                        recordRenderSurfaceMediaFrame();
                    }
                    return;
                }
                var now = performance.now();
                var elapsed = (now - clock.lastDraw) / 1000;
                if (!clock.fallback && elapsed < 0.1) return;
                clock.fallback = true;
                clock.inside = true;
                try {
                    if (typeof advanceMediaRecordingInteractions === 'function') advanceMediaRecordingInteractions();
                    renderSurfaceAdvanceFrame(player, Math.min(0.25, Math.max(0, elapsed)));
                    clock.lastDraw = now;
                    recordRenderSurfaceMediaFrame();
                    player.startRendering();
                } catch (error) {
                    clock.fallback = false;
                    if (window.__ravRenderSurfaceEmit) window.__ravRenderSurfaceEmit('render-surface:error', {
                        recoverable: true, phase: 'frame-clock', message: String(error.message || error),
                    });
                } finally { clock.inside = false; }
            };
        }

        function stepRenderSurfaceFrames(payload) {
            if (typeof getRenderSurfaceMediaState === 'function' && getRenderSurfaceMediaState().recording) {
                throw new Error('Stop recording before stepping frames; recording owns animation advancement.');
            }
            var count = payload.frames == null ? 1 : Number(payload.frames);
            var fps = payload.fps == null ? 60 : Number(payload.fps);
            if (!Number.isInteger(count) || count < 1 || count > 600 || !Number.isFinite(fps) || fps < 1 || fps > 240) {
                throw new Error('Step requires 1–600 frames and an FPS between 1 and 240.');
            }
            // play enables the selected animatable; stopRendering removes its RAF.
            var target = window.__ravRenderSurfaceTarget || {};
            riveInstance.play(target.name);
            var receipt;
            for (var i = 0; i < count; i++) receipt = renderSurfaceAdvanceFrame(riveInstance, 1 / fps);
            riveInstance.pause(target.name);
            recordRenderSurfaceMediaFrame();
            return { frames: count, fps: fps, advancedSeconds: count / fps, rendered: receipt.rendered };
        }
