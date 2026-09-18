        // The Properties drawer tells the child exactly which control rows are
        // currently visible/expanded (the 'watch-controls' render-surface
        // command, sent host -> child, debounced on drawer render/expand/
        // scroll/instance-change). Every watched key is read on every advance,
        // the same as the automatic hot set, but membership is host-driven
        // instead of change-driven: a watched control that never changes is
        // still read every advance because the user is looking straight at
        // it, while a hot control that stops changing eventually falls back
        // to the cold round-robin. WATCH_SET_CAP bounds this independently of
        // the automatic hot set so a large drawer selection cannot grow the
        // per-advance read budget without limit; the host is expected to send
        // its own viewport-prioritized keys first when it must truncate.
        var WATCH_SET_CAP = 64;

        function setRenderSurfaceWatchedControls(bridgeState, keys) {
            if (!bridgeState) return { capped: false, count: 0 };
            var requested = Array.isArray(keys)
                ? keys.filter(function (key) { return typeof key === 'string' && key; })
                : [];
            var deduped = requested.filter(function (key, index) { return requested.indexOf(key) === index; });
            bridgeState.watchControlKeys = deduped.slice(0, WATCH_SET_CAP);
            return {
                capped: deduped.length > WATCH_SET_CAP,
                count: bridgeState.watchControlKeys.length,
            };
        }

        function getRenderSurfaceWatchSetDiagnostics(bridgeState) {
            var watched = bridgeState && bridgeState.watchControlKeys;
            return {
                cap: WATCH_SET_CAP,
                count: watched ? watched.length : 0,
            };
        }
