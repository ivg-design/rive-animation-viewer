        function renderSurfaceImageSnapshotKey(descriptor) {
            if (!descriptor || typeof descriptor !== 'object') return null;
            return String(descriptor.source || 'view-model') + ':' + String(descriptor.globalViewModelName || '') + ':' + String(descriptor.path || descriptor.name || '');
        }

        function normalizeRenderSurfaceImageSelection(selection) {
            if (!selection || typeof selection !== 'object') return null;
            var kind = String(selection.kind || '');
            if (kind === 'embedded' && typeof selection.key === 'string' && selection.key) {
                return {
                    kind: kind,
                    key: selection.key,
                    label: typeof selection.label === 'string' ? selection.label : '',
                };
            }
            if (kind === 'file' && typeof selection.label === 'string' && selection.label) {
                return { kind: kind, label: selection.label };
            }
            return null;
        }

        function rememberRenderSurfaceImageCommand(descriptor) {
            var key = renderSurfaceImageSnapshotKey(descriptor);
            if (!key) return;
            renderSurfaceImageSnapshot.set(key, {
                action: descriptor.action === 'clear-image' || descriptor.value == null ? 'clear-image' : 'set-image',
                descriptor: Object.assign({}, descriptor, {
                    value: Array.isArray(descriptor.value) ? descriptor.value.slice() : descriptor.value,
                }),
                selection: normalizeRenderSurfaceImageSelection(descriptor.imageSelection),
            });
            if (typeof isRenderSurfaceMode !== 'undefined' && isRenderSurfaceMode) {
                var canonicalDescriptor = normalizeControlDescriptor(descriptor);
                var bridgeState = getRenderSurfaceBridgeState();
                var bindingKey = controlSnapshotKeyForDescriptor(canonicalDescriptor);
                var binding = bindingKey ? bridgeState.controlBindingIndex.get(bindingKey) : null;
                if (binding) observeRenderSurfaceBinding(bridgeState, binding);
            }
        }

        // Web runtime image accessors can accept a decoded image but continue
        // to report `null` through their getter. The child is nevertheless the
        // authoritative renderer, so a command it has applied is the durable
        // source of truth for image presence until another applied command
        // replaces it. Return null when no such command exists so authored
        // images can still use the runtime getter as their initial value.
        function readAcknowledgedRenderSurfaceImagePresence(descriptor) {
            var key = renderSurfaceImageSnapshotKey(descriptor);
            if (!key || !renderSurfaceImageSnapshot.has(key)) return null;
            var entry = renderSurfaceImageSnapshot.get(key);
            return Boolean(entry && entry.action !== 'clear-image');
        }

        function readAcknowledgedRenderSurfaceImageMetadata(descriptor) {
            var key = renderSurfaceImageSnapshotKey(descriptor);
            if (!key || !renderSurfaceImageSnapshot.has(key)) return null;
            var entry = renderSurfaceImageSnapshot.get(key);
            if (!entry || entry.action === 'clear-image' || !entry.selection) return null;
            return Object.assign({}, entry.selection);
        }

        function waitForRenderSurfaceImagePresentation(mutationAdvanceRevision) {
            var presentationTimeoutMs = 2000;
            var scheduleFrame = typeof window.requestAnimationFrame === 'function'
                ? window.requestAnimationFrame.bind(window)
                : function (callback) { return window.setTimeout(callback, 0); };
            // Browser RAF is only a compositor opportunity. It does not prove
            // that Rive advanced after consuming this mutation. Wait for a
            // child-owned onAdvance revision, then cross one compositor frame
            // before acknowledging or releasing the decoded image. Bound this
            // child-owned fence below the parent's command timeout: a runtime
            // that never advances must reject this command and release the
            // serialized bridge for later controls instead of wedging it.
            return new Promise(function (resolve, reject) {
                var settled = false;
                var timeoutId = window.setTimeout(function () {
                    if (settled) return;
                    settled = true;
                    reject(new Error('Image presentation timed out before the Rive renderer advanced.'));
                }, presentationTimeoutMs);
                var resolvePresented = function (result) {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timeoutId);
                    resolve(result);
                };
                var waitForAdvance = function () {
                    if (settled) return;
                    var currentRevision = Number(renderSurfaceAdvanceRevision) || 0;
                    if (currentRevision <= mutationAdvanceRevision) {
                        scheduleFrame(waitForAdvance);
                        return;
                    }
                    scheduleFrame(function () {
                        if (settled) return;
                        resolvePresented({
                            advanceRevision: currentRevision,
                            frames: 1,
                            presented: true,
                            rendererAdvanced: true,
                        });
                    });
                };
                scheduleFrame(waitForAdvance);
            });
        }

        function restartRenderSurfaceAfterImageMutation() {
            if (!riveInstance || riveInstance.isPlaying === true) {
                return { restarted: false };
            }
            // isPlaying describes authored playback, not whether the WebGL
            // render loop is consuming VM mutations. startRendering wakes the
            // renderer without seeking or restarting a paused animation.
            if (typeof riveInstance.startRendering === 'function') {
                riveInstance.startRendering();
                return { method: 'startRendering', restarted: true };
            }
            return { restarted: false };
        }

        function applyRenderSurfaceImageCommand(rawDescriptor, remember) {
            var imageDescriptor = rawDescriptor && typeof rawDescriptor === 'object' ? rawDescriptor : {};
            var imageAccessor = imageDescriptor.source === 'global-view-model'
                ? resolveGlobalVmAccessor(imageDescriptor.globalViewModelName, imageDescriptor.path, 'image')
                : resolveLiveAccessor(imageDescriptor.path, 'image');
            if (!imageAccessor || !('value' in imageAccessor)) {
                return Promise.reject(new Error('Image control is unavailable.'));
            }
            if (imageDescriptor.action === 'clear-image' || imageDescriptor.value == null) {
                var clearAdvanceRevision = Number(renderSurfaceAdvanceRevision) || 0;
                imageAccessor.value = null;
                var clearRendering = restartRenderSurfaceAfterImageMutation();
                return waitForRenderSurfaceImagePresentation(clearAdvanceRevision).then(function (presentation) {
                    // The snapshot is explicitly the acknowledged image state.
                    // Do not journal a mutation that never crossed its renderer
                    // presentation fence and was rejected to the parent.
                    if (remember) rememberRenderSurfaceImageCommand(imageDescriptor);
                    return {
                        cleared: true,
                        descriptor: imageDescriptor,
                        presentation: presentation,
                        rendering: clearRendering,
                    };
                });
            }
            if (!loadedRiveRuntime || typeof loadedRiveRuntime.decodeImage !== 'function') {
                return Promise.reject(new Error('The active runtime cannot decode images.'));
            }
            var imageBytes;
            try {
                imageBytes = validateRenderSurfaceImageBytes(imageDescriptor.value);
            } catch (error) {
                return Promise.reject(error);
            }
            var imageAdvanceRevision = Number(renderSurfaceAdvanceRevision) || 0;
            return Promise.resolve(loadedRiveRuntime.decodeImage(imageBytes)).then(function (image) {
                if (!image) throw new Error('The runtime could not decode the image.');
                imageAccessor.value = image;
                var imageRendering = restartRenderSurfaceAfterImageMutation();
                return waitForRenderSurfaceImagePresentation(imageAdvanceRevision).then(function (presentation) {
                    if (remember) rememberRenderSurfaceImageCommand(imageDescriptor);
                    return {
                        descriptor: imageDescriptor,
                        imageApplied: true,
                        presentation: presentation,
                        rendering: imageRendering,
                    };
                }).finally(function () {
                    // The accessor retains the assigned render image. Keep our
                    // temporary decode reference alive until the frame fence so
                    // a deferred WebGL draw can never observe a released asset.
                    if (typeof image.unref === 'function') image.unref();
                });
            });
        }

        function restoreRenderSurfaceImageSnapshot(options) {
            var pruneFailures = !options || options.pruneFailures !== false;
            var restoration = Promise.resolve();
            renderSurfaceImageSnapshot.forEach(function (entry, key) {
                restoration = restoration.then(function () {
                    return applyRenderSurfaceImageCommand(entry.descriptor, false);
                }).catch(function () {
                    // Runtime-generated list rows may not exist until the
                    // first advancing frame after reset. The reset contract
                    // performs one non-pruning attempt before playback starts
                    // and one final pruning attempt after its frame fence.
                    // Direct callers keep the historical prune-on-failure
                    // behavior so stale/decode-failed entries stay bounded.
                    if (pruneFailures) renderSurfaceImageSnapshot.delete(key);
                });
            });
            return restoration;
        }

        // `Rive.reset()` is an in-place operation. Unlike a fresh Rive
        // construction it is not required to call onLoad, so a reset receipt
        // must not be coupled to the load lifecycle.  The child owns the
        // visual surface; restore its snapshot and cross two presentation
        // opportunities before acknowledging the applied reset. Canonical
        // reconciliation is scheduled only after that ACK is transported.
        function settleRenderSurfaceResetAfterPresentation(pendingReset) {
            if (!pendingReset || pendingReset.presentationScheduled) return;
            pendingReset.presentationScheduled = true;
            var resetFrame = typeof window.requestAnimationFrame === 'function'
                ? window.requestAnimationFrame.bind(window)
                : function (callback) { return window.setTimeout(callback, 0); };
            var resetSnapshot = Array.isArray(pendingReset.snapshot)
                ? pendingReset.snapshot
                : currentControlSnapshot;
            Promise.resolve().then(function () {
                // Scalar/enum/state-machine values can be recreated by a
                // runtime reset, just like image accessors. Re-queue before
                // image restoration so both kinds resolve against the same
                // live ViewModel instance.
                applyControlSnapshot(resetSnapshot);
                return restoreRenderSurfaceImageSnapshot({ pruneFailures: false });
            }).then(function () {
                // reset() recreated animatables as playing but did not restart
                // the runtime RAF loop in affected Web runtime builds. Restart
                // only after VM/list/image restoration so the first advancing
                // frame observes the authoritative reset snapshot.
                pendingReset.playbackRestart = restartRenderSurfacePlaybackAfterReset(
                    riveInstance,
                    pendingReset.params,
                );
                resetFrame(function () {
                    resetFrame(function () {
                        // Some list-backed accessors appear on the first
                        // advance after reset. Retrying here keeps their
                        // restoration bounded without polling topology.
                        if (pendingRenderSurfaceReset !== pendingReset) return;
                        restoreRenderSurfaceImageSnapshot({ pruneFailures: true }).then(function () {
                            if (pendingRenderSurfaceReset !== pendingReset) return;
                            retryPendingControlSnapshot();
                            var unresolvedControlCount = pendingControlSnapshot.size;
                            if (unresolvedControlCount > 0) {
                                // Runtime-list rows can disappear or be replaced
                                // during reset. Do not leave their old descriptors
                                // queued where an unrelated future row at the same
                                // path could inherit stale pre-reset data.
                                pendingControlSnapshot.clear();
                                if (typeof scheduleRenderSurfaceCanonicalRefresh === 'function') {
                                    scheduleRenderSurfaceCanonicalRefresh('reset-first-frame', true);
                                }
                                pendingReset.reject(new Error(
                                    'Playback reset could not restore '
                                    + unresolvedControlCount
                                    + ' control value'
                                    + (unresolvedControlCount === 1 ? '.' : 's.'),
                                ));
                                return;
                            }
                            pendingReset.resolve({
                                pending: 0,
                                reset: true,
                                restored: resetSnapshot.length,
                                playbackRestart: pendingReset.playbackRestart,
                                presentationFrames: 2,
                            });
                        }).catch(function (error) {
                            pendingControlSnapshot.clear();
                            if (typeof scheduleRenderSurfaceCanonicalRefresh === 'function') {
                                scheduleRenderSurfaceCanonicalRefresh('reset-first-frame', true);
                            }
                            pendingReset.reject(error);
                        });
                    });
                });
            }).catch(function (error) {
                pendingControlSnapshot.clear();
                if (typeof scheduleRenderSurfaceCanonicalRefresh === 'function') {
                    scheduleRenderSurfaceCanonicalRefresh('reset-first-frame', true);
                }
                pendingReset.reject(error);
            });
        }
