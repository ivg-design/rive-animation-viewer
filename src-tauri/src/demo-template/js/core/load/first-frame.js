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

        function waitForRenderSurfacePresentationFrames(frameCount) {
            var requiredFrames = Math.max(1, Number(frameCount) || 2);
            return new Promise(function (resolve) {
                var observedFrames = 0;
                var timerFallbacks = 0;
                var nextFrame = function (usedTimerFallback) {
                    if (usedTimerFallback) timerFallbacks += 1;
                    observedFrames += 1;
                    if (observedFrames >= requiredFrames) {
                        var result = { frames: observedFrames, presented: true };
                        if (timerFallbacks) result.timerFallbacks = timerFallbacks;
                        resolve(result);
                        return;
                    }
                    schedulePresentationOpportunity();
                };
                var schedulePresentationOpportunity = function () {
                    var settled = false;
                    var frameId = null;
                    var timerId = null;
                    var settle = function (usedTimerFallback) {
                        if (settled) return;
                        settled = true;
                        if (timerId !== null && typeof window.clearTimeout === 'function') {
                            window.clearTimeout(timerId);
                        }
                        if (usedTimerFallback && frameId !== null
                            && typeof window.cancelAnimationFrame === 'function') {
                            window.cancelAnimationFrame(frameId);
                        }
                        nextFrame(usedTimerFallback);
                    };
                    // A fully clipped or backgrounded WKWebView can expose rAF
                    // while indefinitely suppressing its callbacks. Keep each
                    // of the two presentation opportunities bounded so the
                    // child command lane can still transport prepare-frame's
                    // ACK before the parent command deadline.
                    timerId = window.setTimeout(function () { settle(true); }, 250);
                    if (typeof window.requestAnimationFrame === 'function') {
                        frameId = window.requestAnimationFrame(function () { settle(false); });
                    }
                };
                schedulePresentationOpportunity();
            });
        }
