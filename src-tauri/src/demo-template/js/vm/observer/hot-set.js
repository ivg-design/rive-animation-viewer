        // A control that changes on every rendered frame (a pointer-coordinate
        // readout written by a script, for example) must not wait for its
        // round-robin turn to come back around -- on a large binding list that
        // turn is seconds away. This hot set tracks bindings that changed
        // recently so the observer can read them on every advance from a
        // second, small, capped budget instead. It has two independent
        // eviction rules that both bound its size to HOT_SET_CAP:
        //   1. TTL: a member stops being read as hot after
        //      HOT_SET_UNCHANGED_EVICT_ADVANCES consecutive hot reads find no
        //      change (it settled; the cold round-robin resumes covering it).
        //   2. LRU-on-cap: if the set is already full and a different,
        //      previously-cold binding is observed to change, the
        //      least-recently-changed hot member is evicted to make room.
        // Membership is keyed by the same string key used everywhere else
        // (bridgeState.controlBindingIndex), not by binding object identity,
        // so it survives a topology rescan that rebuilds binding objects for
        // an unrelated part of the tree.
        var HOT_SET_CAP = 16;
        var HOT_SET_UNCHANGED_EVICT_ADVANCES = 30;

        function noteRenderSurfaceControlObservation(bridgeState, key, changed) {
            if (!bridgeState || !key) return;
            var hot = bridgeState.hotControlKeys;
            if (changed) {
                // Re-inserting moves this key to the Map's most-recently-used
                // end; the least-recently-changed member is always first.
                hot.delete(key);
                hot.set(key, 0);
                while (hot.size > HOT_SET_CAP) {
                    var oldest = hot.keys().next().value;
                    if (oldest === undefined) break;
                    hot.delete(oldest);
                }
                return;
            }
            if (!hot.has(key)) return;
            var unchangedStreak = (hot.get(key) || 0) + 1;
            if (unchangedStreak >= HOT_SET_UNCHANGED_EVICT_ADVANCES) {
                hot.delete(key);
            } else {
                // Re-setting an existing Map key updates its value without
                // moving its iteration position, so the streak count grows
                // while the LRU ordering keeps reflecting last-changed time.
                hot.set(key, unchangedStreak);
            }
        }

        function renderSurfaceControlIsHot(bridgeState, key) {
            return Boolean(bridgeState && key && bridgeState.hotControlKeys.has(key));
        }

        function resetRenderSurfaceHotSet(bridgeState) {
            if (bridgeState) bridgeState.hotControlKeys = new Map();
        }

        function getRenderSurfaceHotSetDiagnostics(bridgeState) {
            var hot = bridgeState && bridgeState.hotControlKeys;
            return {
                cap: HOT_SET_CAP,
                count: hot ? hot.size : 0,
                unchangedEvictAdvances: HOT_SET_UNCHANGED_EVICT_ADVANCES,
            };
        }
