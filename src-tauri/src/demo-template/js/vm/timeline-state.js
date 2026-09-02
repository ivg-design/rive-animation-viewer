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
            var active = findLastAnimation(function (animation) {
                return animation && animation.playing && animation.name === targetName;
            }) || findLastAnimation(function (animation) {
                return animation && animation.playing;
            }) || findLastAnimation(function (animation) {
                return animation && animation.name === targetName;
            });
            if (!active) return null;
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
                totalFrames: totalFrames,
                totalSeconds: totalSeconds,
            };
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

        function rememberActiveTimelineMetrics(bridgeState, target, metrics) {
            if (!target || target.type !== 'animation' || !target.name || !metrics) return metrics;
            bridgeState.timelineSnapshot = { completed: false, metrics: Object.assign({}, metrics), name: target.name };
            return metrics;
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

        function recordRenderSurfaceTimelineAdvance() {
            var target = getRenderSurfaceBridgeState().playbackTarget || window.__ravRenderSurfaceTarget || {};
            if (target.type !== 'animation' || !target.name) return null;
            var metrics = captureActiveTimelineMetrics(target.name);
            if (!metrics) return null;
            rememberActiveTimelineMetrics(getRenderSurfaceBridgeState(), target, metrics);
            // Timeline position is an animation-clock signal, not a ViewModel
            // snapshot. Publish its tiny payload on every renderer advance so
            // the host CTI observes each frame while the heavier canonical
            // state remains safely throttled.
            if (isRenderSurfaceMode && typeof window.__ravRenderSurfaceEmit === 'function') {
                window.__ravRenderSurfaceEmit('render-surface:timeline', Object.assign({
                    advanceRevision: renderSurfaceAdvanceRevision,
                    isPaused: false,
                    isPlaying: true,
                    playbackName: target.name,
                    playbackType: 'animation',
                }, metrics));
            }
            return metrics;
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
            var hasWrapper = wrappers.some(function (animation) { return animation && animation.name === target.name; });
            // Rive prunes one-shot wrappers at completion. Recreate the target
            // paused so the retained terminal status can still seek backward.
            if (!hasWrapper && typeof riveInstance.pause === 'function') riveInstance.pause(target.name);
            riveInstance.scrub(target.name, requestedSeconds);
            var metrics = captureActiveTimelineMetrics(target.name) || Object.assign({}, before || {}, {
                currentFrame: before && before.fps ? Math.round(requestedSeconds * before.fps) : null,
                currentSeconds: requestedSeconds,
            });
            rememberActiveTimelineMetrics(bridgeState, target, metrics);
            return {
                currentFrame: metrics.currentFrame,
                currentSeconds: metrics.currentSeconds,
                name: target.name,
                totalFrames: metrics.totalFrames,
                totalSeconds: metrics.totalSeconds,
            };
        }
