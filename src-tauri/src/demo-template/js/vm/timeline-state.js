        function readFiniteAnimationMetric(animation, propertyNames, minimum) {
            if (!animation) return null;
            for (var index = 0; index < propertyNames.length; index += 1) {
                var value = readCanonicalMember(animation, propertyNames[index]);
                if (value === null) continue;
                var numeric = Number(value);
                if (Number.isFinite(numeric) && (minimum === undefined || numeric >= minimum)) return numeric;
            }
            return null;
        }

        function captureActiveTimelineMetrics(targetName) {
            var animations = riveInstance && riveInstance.animator && Array.isArray(riveInstance.animator.animations)
                ? riveInstance.animator.animations
                : [];
            var findLastAnimation = function (predicate) {
                for (var index = animations.length - 1; index >= 0; index -= 1) {
                    if (predicate(animations[index])) return animations[index];
                }
                return null;
            };
            // Only the named timeline may report its clock. Falling back to
            // "any playing wrapper" reported a sibling animation's time under
            // the target's name once the target was paused.
            // The animator can hold several wrappers with the target's name
            // (a stale one from a previous artboard keeps a frozen clock).
            // Movement is tracked per wrapper object, never via one shared
            // scalar, so a frozen wrapper can never be mistaken for the live one.
            var candidates = animations.filter(function (animation) { return animation && animation.name === targetName; });
            // Wrapper objects may be re-materialised per access, so identity is
            // keyed by the target name plus the wrapper's position among the
            // same-name candidates rather than by object reference.
            var moved = [];
            var movedKeys = {};
            candidates.forEach(function (animation, index) {
                var key = targetName + '#' + index;
                var now = readFiniteAnimationMetric(animation, ['time'], 0);
                var seen = wrapperClocks[key];
                wrapperClocks[key] = now;
                if (seen !== undefined && now !== null && now !== seen) {
                    moved.push(animation); movedKeys[key] = true;
                    var span = readFiniteAnimationMetric(animation.animation, ['durationSeconds', 'totalSeconds'], 0);
                    if (span === null || Math.abs(now - seen) <= span / 2) wrapperDirections[key] = now > seen ? 1 : -1;
                }
            });
            var flagged = candidates.filter(function (animation) { return animation.playing; });
            var lastKnown = lastActiveKey && lastActiveKey.name === targetName && candidates[lastActiveKey.index]
                ? candidates[lastActiveKey.index] : null;
            var active = (flagged.length ? flagged[flagged.length - 1] : null)
                || (moved.length ? moved[moved.length - 1] : null)
                || lastKnown
                || (candidates.length ? candidates[candidates.length - 1] : null);
            if (!active) return null;
            var activeIndex = candidates.indexOf(active);
            lastActiveKey = { name: targetName, index: activeIndex };
            var isMoving = Boolean(movedKeys[targetName + '#' + activeIndex]);
            var currentSeconds = readFiniteAnimationMetric(active, ['time'], 0)
                ?? readFiniteAnimationMetric(active.instance, ['time'], 0);
            var fps = readFiniteAnimationMetric(active.animation, ['fps'], Number.EPSILON)
                ?? readFiniteAnimationMetric(active.instance, ['fps'], Number.EPSILON)
                ?? readFiniteAnimationMetric(active, ['fps'], Number.EPSILON);
            var totalFrames = readFiniteAnimationMetric(active.animation, ['duration', 'durationFrames', 'totalFrames'], 0)
                ?? readFiniteAnimationMetric(active.instance, ['duration', 'durationFrames', 'totalFrames'], 0)
                ?? readFiniteAnimationMetric(active, ['durationFrames', 'totalFrames'], 0);
            var totalSeconds = readFiniteAnimationMetric(active.animation, ['durationSeconds', 'totalSeconds'], 0)
                ?? readFiniteAnimationMetric(active.instance, ['durationSeconds', 'totalSeconds'], 0)
                ?? readFiniteAnimationMetric(active, ['durationSeconds', 'totalSeconds'], 0);
            if (totalSeconds === null && totalFrames !== null && fps !== null) totalSeconds = totalFrames / fps;
            if (totalFrames === null && totalSeconds !== null && fps !== null) totalFrames = Math.round(totalSeconds * fps);
            return {
                currentFrame: currentSeconds !== null && fps !== null ? Math.round(currentSeconds * fps) : null,
                currentSeconds: currentSeconds,
                fps: fps,
                // Advancing means this wrapper's clock moved since it was last
                // read; the wrapper flag alone is not reliable across runtimes.
                playing: Boolean(active.playing) || isMoving,
                speed: readFiniteAnimationMetric(active.animation, ['speed'])
                    ?? readFiniteAnimationMetric(active.instance, ['speed'])
                    ?? readFiniteAnimationMetric(active, ['speed']),
                direction: wrapperDirections[targetName + '#' + activeIndex] || null,
                totalFrames: totalFrames,
                totalSeconds: totalSeconds,
            };
        }

        function timelineMetricsPayload(metrics) {
            if (!metrics) return null;
            var payload = Object.assign({}, metrics);
            delete payload.playing;
            if (payload.speed === null || payload.speed === undefined) delete payload.speed;
            if (payload.direction !== 1 && payload.direction !== -1) delete payload.direction;
            return payload;
        }

        function emitRenderSurfaceTimeline(target, metrics, playing) {
            if (!isRenderSurfaceMode || typeof window.__ravRenderSurfaceEmit !== 'function') return;
            window.__ravRenderSurfaceEmit('render-surface:timeline', Object.assign({
                advanceRevision: renderSurfaceAdvanceRevision,
                isPaused: !playing,
                isPlaying: Boolean(playing),
                playbackName: target.name,
                playbackType: 'animation',
            }, timelineMetricsPayload(metrics)));
        }

        function timelineEventNames(event) {
            var data = event && event.data;
            if (Array.isArray(data)) return data.filter(function (name) { return typeof name === 'string' && name; });
            if (typeof data === 'string' && data) return [data];
            return [];
        }

        function timelineSnapshotMatchesTarget(snapshot, target) {
            return Boolean(snapshot && target && target.type === 'animation' && snapshot.name === target.name);
        }

        var wrapperClocks = {};

        // Observed clock direction per wrapper (+1 forward, -1 backward). Ping-pong
        // loops reverse the clock on every other leg; a loop wrap (a jump of more
        // than half the duration) is not a direction change.
        var wrapperDirections = {};
        var lastActiveKey = null;
        function rememberActiveTimelineMetrics(bridgeState, target, metrics) {
            if (!target || target.type !== 'animation' || !target.name || !metrics) return metrics;
            bridgeState.timelineSnapshot = { completed: false, metrics: timelineMetricsPayload(metrics), name: target.name };
            return metrics;
        }

        // A pause is a clock event too: publish the target's resting time once
        // with isPlaying=false so the host stops presenting frames immediately.
        function recordRenderSurfaceTimelinePause(event) {
            var target = getRenderSurfaceBridgeState().playbackTarget || window.__ravRenderSurfaceTarget || {};
            if (target.type !== 'animation' || !target.name) return null;
            var names = timelineEventNames(event);
            if (names.length && names.indexOf(target.name) < 0) return null;
            var metrics = captureActiveTimelineMetrics(target.name);
            if (!metrics) return null;
            rememberActiveTimelineMetrics(getRenderSurfaceBridgeState(), target, metrics);
            emitRenderSurfaceTimeline(target, metrics, false);
            return timelineMetricsPayload(metrics);
        }

        // The runtime's named stop event plus its source duration are the
        // child-owned completion receipt. A missing wrapper alone is never
        // treated as completion because paused wrappers retain partial time.
        function recordRenderSurfaceTimelineStop(event) {
            var target = getRenderSurfaceBridgeState().playbackTarget || window.__ravRenderSurfaceTarget || {};
            if (target.type !== 'animation' || !target.name || timelineEventNames(event).indexOf(target.name) < 0) return null;
            var bridgeState = getRenderSurfaceBridgeState();
            var active = captureActiveTimelineMetrics(target.name);
            var remembered = timelineSnapshotMatchesTarget(bridgeState.timelineSnapshot, target)
                ? bridgeState.timelineSnapshot.metrics : null;
            var metrics = remembered || active;
            if (!metrics) return null;
            var completed = Object.assign({}, metrics);
            if (completed.totalSeconds !== null && completed.totalSeconds !== undefined) completed.currentSeconds = completed.totalSeconds;
            if (completed.totalFrames !== null && completed.totalFrames !== undefined) completed.currentFrame = completed.totalFrames;
            bridgeState.timelineSnapshot = { completed: true, metrics: completed, name: target.name };
            return completed;
        }

        function recordRenderSurfaceTimelinePlay(event) {
            var target = getRenderSurfaceBridgeState().playbackTarget || window.__ravRenderSurfaceTarget || {};
            if (target.type !== 'animation' || !target.name || timelineEventNames(event).indexOf(target.name) < 0) return false;
            getRenderSurfaceBridgeState().timelineSnapshot = null;
            return true;
        }

        function bridgeState_hasSnapshotFor(target) {
            var snapshot = getRenderSurfaceBridgeState().timelineSnapshot;
            return Boolean(snapshot && target && snapshot.name === target.name);
        }

        function recordRenderSurfaceTimelineAdvance() {
            var target = getRenderSurfaceBridgeState().playbackTarget || window.__ravRenderSurfaceTarget || {};
            if (target.type !== 'animation' || !target.name) return null;
            var metrics = captureActiveTimelineMetrics(target.name);
            if (!metrics) return null;
            // Timeline position is an animation-clock signal, not a ViewModel
            // snapshot. Publish its tiny payload on every renderer advance so
            // the host CTI observes each frame while the heavier canonical
            // state remains safely throttled. A paused target does not
            // advance, so its clock is not republished by sibling advances.
            if (!metrics.playing && bridgeState_hasSnapshotFor(target)) return timelineMetricsPayload(metrics);
            rememberActiveTimelineMetrics(getRenderSurfaceBridgeState(), target, metrics);
            emitRenderSurfaceTimeline(target, metrics, true);
            return timelineMetricsPayload(metrics);
        }

        var SCRUB_REPAINT_SECONDS = 0.000001;
        var SCRUB_END_GUARD_SECONDS = 0.0001;

        // Seek a paused wrapper and repaint it without letting wall time into
        // the artboard. rive.js applies a pending `scrubTo` on the next frame as
        // `time = 0; advance(value)` for paused wrappers too, and advance()
        // scales by the authored speed. Calling scrub() instead would also draw a
        // frame with the real elapsed time since the last draw, which advances
        // every other clock in the artboard (nested artboards, state machines)
        // on each drag event: the timeline appears to run while being dragged.
        // The explicit frame must advance by a positive interval; measured on
        // rive.js 2.42.2 a zero-length draw leaves the previous pose on screen.
        function seekPausedWrapper(wrapper, name, seconds, speed) {
            // An animation that does not expose a speed plays at 1x.
            var multiplier = speed === null ? 1 : speed;
            if (wrapper && multiplier > 0) {
                wrapper.scrubTo = seconds / multiplier;
                repaintExplicitFrame();
                return;
            }
            if (!wrapper) {
                riveInstance.scrub(name, seconds);
                return;
            }
            // Reversed or zero-speed timelines cannot land through advance():
            // set the clock directly, then play for exactly one explicit frame.
            wrapper.scrubTo = null;
            wrapper.time = seconds;
            if (typeof riveInstance.play === 'function' && typeof riveInstance.pause === 'function') {
                try {
                    riveInstance.lastRenderTime = Math.max(1001, performance.now());
                    riveInstance.play(name);
                    repaintExplicitFrame();
                } catch (error) { /* draw unavailable; the time still applied */ }
                riveInstance.pause(name);
            }
        }

        function repaintExplicitFrame() {
            if (typeof renderSurfaceAdvanceFrame !== 'function') return;
            try { renderSurfaceAdvanceFrame(riveInstance, SCRUB_REPAINT_SECONDS); } catch (error) { /* draw unavailable */ }
        }

        function scrubRenderSurfaceTimeline(payload) {
            if (!riveInstance || typeof riveInstance.scrub !== 'function') {
                throw new Error('Timeline scrubbing is unavailable.');
            }
            var bridgeState = getRenderSurfaceBridgeState();
            var target = bridgeState.playbackTarget || window.__ravRenderSurfaceTarget || {};
            if (target.type !== 'animation' || !target.name) {
                throw new Error('Timeline scrubbing requires an active linear animation.');
            }
            var requestedName = payload && typeof payload.name === 'string' ? payload.name : target.name;
            if (requestedName !== target.name) {
                throw new Error('Timeline scrub target does not match the active animation.');
            }
            var before = captureActiveTimelineMetrics(target.name);
            if (!before && timelineSnapshotMatchesTarget(bridgeState.timelineSnapshot, target)) {
                before = bridgeState.timelineSnapshot.metrics;
            }
            var requestedSeconds = Number(payload && payload.seconds);
            if (!Number.isFinite(requestedSeconds)) {
                var requestedFrame = Number(payload && payload.frame);
                if (Number.isFinite(requestedFrame) && before && before.fps) {
                    requestedSeconds = requestedFrame / before.fps;
                }
            }
            if (!Number.isFinite(requestedSeconds)) throw new Error('Timeline scrub time is invalid.');
            requestedSeconds = Math.max(0, requestedSeconds);
            if (before && Number.isFinite(before.totalSeconds)) {
                requestedSeconds = Math.min(before.totalSeconds, requestedSeconds);
            }
            var wrappers = riveInstance.animator && Array.isArray(riveInstance.animator.animations)
                ? riveInstance.animator.animations : [];
            // Dragging pauses. A scrub is a manual seek; a wrapper left playing
            // would run away from the landed frame before the next drag event.
            // Pausing also recreates a wrapper that Rive pruned at one-shot
            // completion, so the retained terminal status can still seek backward.
            if (typeof riveInstance.pause === 'function') riveInstance.pause(target.name);
            var wrapper = null;
            for (var wi = wrappers.length - 1; wi >= 0; wi -= 1) {
                if (wrappers[wi] && wrappers[wi].name === target.name) { wrapper = wrappers[wi]; break; }
            }
            var speed = wrapper ? readFiniteAnimationMetric(wrapper.animation, ['speed']) : null;
            if (before && Number.isFinite(before.totalSeconds) && before.totalSeconds > 0) {
                // Exactly the end of a looping timeline wraps to frame 0 inside the
                // runtime; stop a hair short so the last frame stays on screen.
                requestedSeconds = Math.min(requestedSeconds, Math.max(0, before.totalSeconds - SCRUB_END_GUARD_SECONDS));
            }
            seekPausedWrapper(wrapper, target.name, requestedSeconds, speed);
            var metrics = captureActiveTimelineMetrics(target.name) || Object.assign({}, before || {}, {
                currentFrame: before && before.fps ? Math.round(requestedSeconds * before.fps) : null,
                currentSeconds: requestedSeconds,
            });
            rememberActiveTimelineMetrics(bridgeState, target, metrics);
            var reply = {
                currentFrame: metrics.currentFrame,
                currentSeconds: metrics.currentSeconds,
                fps: metrics.fps,
                name: target.name,
                totalFrames: metrics.totalFrames,
                totalSeconds: metrics.totalSeconds,
            };
            if (Number.isFinite(metrics.speed)) reply.speed = metrics.speed;
            return reply;
        }
