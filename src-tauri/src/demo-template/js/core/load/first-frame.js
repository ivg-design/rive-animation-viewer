        function announceRenderSurfaceFirstFrame(payload) {
            if (!isRenderSurfaceMode || typeof window.__ravRenderSurfaceEmit !== 'function') return false;
            var requestFrame = typeof window.requestAnimationFrame === 'function'
                ? window.requestAnimationFrame.bind(window)
                : function (callback) { return window.setTimeout(callback, 0); };
            var emitted = false;
            var emitOnce = function () {
                if (emitted) return;
                emitted = true;
                window.__ravRenderSurfaceEmit('render-surface:loaded', payload);
            };
            // Static, paused, inert, and already-finished artboards can paint
            // successfully without another Rive onAdvance callback. Two host
            // presentation opportunities are enough to begin the stronger
            // prepare-frame activation fence; the timer covers a throttled
            // staged WebView whose requestAnimationFrame callbacks are delayed.
            requestFrame(function () { requestFrame(emitOnce); });
            window.setTimeout(emitOnce, 250);
            return true;
        }

        async function waitForRenderSurfacePresentationFrames(frameCount) {
            var frames = Math.max(1, Number(frameCount) || 2);
            var timerFallbacks = 0;
            for (var i = 0; i < frames; i++) {
                var fallback = await new Promise(function (resolve) {
                    var settled = false, frameId = null;
                    var timer = window.setTimeout(function () { finish(true); }, 150);
                    function finish(fallback) {
                        if (settled) return;
                        settled = true; window.clearTimeout(timer);
                        if (fallback && frameId != null) window.cancelAnimationFrame(frameId);
                        resolve(fallback);
                    }
                    if (typeof window.requestAnimationFrame === 'function') frameId = window.requestAnimationFrame(function () { finish(false); });
                });
                if (fallback) timerFallbacks++;
                // A timer only wakes this barrier. Completion is a real draw and
                // GPU flush, even if the compositor cannot display a hidden window.
                renderSurfaceAdvanceFrame(riveInstance, 0);
                if (riveInstance.isPlaying) riveInstance.startRendering();
            }
            return { frames: frames, rendered: true, presented: !document.hidden,
                timerFallbacks: timerFallbacks, verifiedBy: 'runtime-draw-flush' };
        }
