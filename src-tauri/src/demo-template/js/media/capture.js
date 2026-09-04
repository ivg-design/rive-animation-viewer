        function getRenderSurfaceMediaState() {
            if (!window.__ravMediaState) window.__ravMediaState = { export: null, recording: null, cursor: null };
            return window.__ravMediaState;
        }

        function applyRenderSurfaceMediaSizing() {
            var state = getRenderSurfaceMediaState();
            var options = state.recording ? state.recording.options : state.export && state.export.live ? state.export.options : null;
            els.canvasContainer.classList.toggle('canvas-container-media-capture', Boolean(options));
            if (!options) return false;
            var canvas = els.canvas, container = els.canvasContainer;
            var scale = Math.min(container.clientWidth / options.width, container.clientHeight / options.height);
            if (!(scale > 0)) scale = 1;
            var displayWidth = options.width * scale, displayHeight = options.height * scale;
            // A small export may be presented much larger than its output size.
            // Keep the live preview at least as dense as the display while the
            // composition canvas still downsamples to the requested output.
            var renderPixelRatio = Math.max(1, scale * (window.devicePixelRatio || 1));
            var renderWidth = Math.max(1, Math.round(options.width * renderPixelRatio));
            var renderHeight = Math.max(1, Math.round(options.height * renderPixelRatio));
            if (canvas.width !== renderWidth) canvas.width = renderWidth;
            if (canvas.height !== renderHeight) canvas.height = renderHeight;
            canvas.style.width = displayWidth + 'px';
            canvas.style.height = displayHeight + 'px';
            // Capture at the requested pixel size; preserve its aspect ratio in
            // the visible preview so pointer coordinates use the same transform.
            if (riveInstance) {
                riveInstance.devicePixelRatioUsed = renderPixelRatio;
                riveInstance.resizeToCanvas();
                if (riveInstance.layout.fit === 'layout') {
                    var layoutScale = riveInstance.layout.layoutScaleFactor || 1;
                    riveInstance.artboard.width = options.width / layoutScale;
                    riveInstance.artboard.height = options.height / layoutScale;
                }
            }
            return true;
        }

        function composeMediaCanvas(canvas, options, cursor, output) {
            output = output || document.createElement('canvas');
            if (output.width !== options.width) output.width = options.width;
            if (output.height !== options.height) output.height = options.height;
            var ctx = output.getContext('2d');
            if (!ctx || output.width * output.height > 4194304) throw new Error('Media canvas exceeds the four megapixel limit.');
            ctx.clearRect(0, 0, output.width, output.height);
            if (!options.alpha) {
                ctx.fillStyle = options.background || '#000000';
                ctx.fillRect(0, 0, output.width, output.height);
            }
            ctx.drawImage(canvas, 0, 0, output.width, output.height);
            if (options.cursor && cursor && cursor.inside) {
                ctx.save(); ctx.translate(cursor.x * output.width, cursor.y * output.height);
                ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 20); ctx.lineTo(5, 15);
                ctx.lineTo(10, 24); ctx.lineTo(14, 22); ctx.lineTo(9, 13); ctx.lineTo(17, 13); ctx.closePath();
                ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#000000'; ctx.lineWidth = 2;
                ctx.fill(); ctx.stroke(); ctx.restore();
            }
            return output;
        }

        function mediaCanvasPng(canvas, options, cursor) {
            var output = composeMediaCanvas(canvas, options, cursor);
            var data = output.toDataURL('image/png').split(',')[1];
            if (!data || data.length > Math.ceil(20 * 1024 * 1024 / 3) * 4) throw new Error('Encoded frame exceeds the 20 MiB transport limit.');
            return data;
        }

        function mediaCanvasPngAsync(canvas, options, cursor, output, encode, binary) {
            // Copy pixels now, but let the browser compress off the draw path.
            // Each bounded recording slot owns its canvas until native ACK.
            output = composeMediaCanvas(canvas, options, cursor, output);
            if (encode) return encode(output.transferToImageBitmap());
            return new Promise(function (resolve, reject) {
                output.toBlob(function (blob) {
                    if (!blob || blob.size > 20 * 1024 * 1024) { reject(new Error('Encoded frame exceeds the 20 MiB transport limit.')); return; }
                    if (binary) { blob.arrayBuffer().then(resolve, reject); return; }
                    var reader = new FileReader();
                    reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
                    reader.onerror = function () { reject(new Error('Could not read the captured frame.')); };
                    reader.readAsDataURL(blob);
                }, 'image/png');
            });
        }

        function restoreMediaPlayerSnapshot(player, snapshot) {
            (snapshot || []).forEach(function (entry) {
                var descriptor = entry.descriptor || entry;
                var kind = entry.kind || descriptor.kind;
                if (kind === 'trigger' || kind === 'image' || descriptor.source === 'state-machine') return;
                var root = descriptor.source === 'global-view-model'
                    ? safeVmCall(player, 'globalViewModelInstance', descriptor.globalViewModelName)
                    : player.viewModelInstance;
                var accessor = resolveVmAccessorFromRoot(root, descriptor.path, kind);
                if (!accessor) throw new Error('Export could not restore property ' + descriptor.path + '.');
                accessor.value = entry.value;
            });
        }

        async function openRenderSurfaceMediaPlayer(options) {
            var state = getRenderSurfaceMediaState();
            if (state.export || state.recording || state.preparing) throw new Error('A capture is already active.');
            var target = window.__ravRenderSurfaceTarget || {};
            if (options.mode !== 'still' && target.type !== 'animation') throw new Error('Select a timeline before exporting animation.');
            if (options.mode === 'still' && options.at_seconds == null) {
                state.export = { live: true, player: riveInstance, canvas: els.canvas, options: options };
                handleResize();
                return { opened: true, width: options.width, height: options.height };
            }
            var canvas = document.createElement('canvas');
            canvas.width = options.width; canvas.height = options.height;
            // Rive's ResizeObserver suppresses drawing on detached/zero-layout
            // canvases. Give capture its own sized, invisible layout surface.
            // visibility:hidden preserves layout; display:none does not.
            canvas.setAttribute('aria-hidden', 'true');
            canvas.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;'
                + 'width:' + options.width + 'px;height:' + options.height + 'px;';
            document.body.appendChild(canvas);
            var binary = atob(CONFIG.animationBase64);
            var bytes = Uint8Array.from(binary, function (char) { return char.charCodeAt(0); });
            var player;
            var session = { player: null, canvas: canvas, options: options, time: 0, name: target.name, cancelled: false };
            state.export = session;
            try {
                await new Promise(function (resolve, reject) {
                    var timer = setTimeout(function () { reject(new Error('Export player load timed out.')); }, 12000);
                    player = new loadedRiveRuntime.Rive({
                        buffer: bytes.buffer, canvas: canvas, artboard: CONFIG.artboardName || undefined,
                        animations: target.name, autoplay: false, autoBind: true,
                        useOffscreenRenderer: true,
                        layout: new loadedRiveRuntime.Layout({
                            fit: resolveRiveLayoutFit(loadedRiveRuntime, currentLayoutFit),
                            alignment: resolveRiveLayoutAlignment(loadedRiveRuntime, currentLayoutAlignment),
                        }),
                        onLoad: function () { clearTimeout(timer); resolve(); },
                        onLoadError: function (error) { clearTimeout(timer); reject(new Error(String(error.message || error))); },
                    });
                    session.player = player;
                });
                if (session.cancelled) throw new Error('Export cancelled.');
                player.stopRendering();
                player.devicePixelRatioUsed = 1;
                player.resizeToCanvas();
                if (player.layout && player.layout.fit === 'layout') {
                    var layoutScale = player.layout.layoutScaleFactor || 1;
                    player.artboard.width = options.width / layoutScale;
                    player.artboard.height = options.height / layoutScale;
                }
                if (target.vmInstanceKey != null && !bindViewModelInstanceByKey(player, target.vmInstanceKey)) {
                    throw new Error('Export ViewModel instance is unavailable.');
                }
                restoreMediaPlayerSnapshot(player, options.snapshot);
                // Restore image overrides from copied bytes, never live WASM objects.
                for (var entry of renderSurfaceImageSnapshot.values()) {
                    var descriptor = entry.descriptor;
                    var root = descriptor.source === 'global-view-model'
                        ? safeVmCall(player, 'globalViewModelInstance', descriptor.globalViewModelName) : player.viewModelInstance;
                    var accessor = resolveVmAccessorFromRoot(root, descriptor.path, 'image');
                    if (!accessor) throw new Error('Export image property is unavailable: ' + descriptor.path);
                    if (entry.action === 'clear-image') accessor.value = null;
                    else {
                        var image = await player.runtime.decodeImage(new Uint8Array(descriptor.value));
                        try { accessor.value = image; } finally { if (image && image.unref) image.unref(); }
                    }
                }
                player.play(target.name);
                renderSurfaceAdvanceFrame(player, 0);
                return { opened: true, width: canvas.width, height: canvas.height };
            } catch (error) {
                if (player) player.cleanup();
                canvas.remove();
                state.export = null;
                throw error;
            }
        }

        async function captureRenderSurfaceMediaFrame(payload) {
            var session = getRenderSurfaceMediaState().export;
            if (!session) throw new Error('No export player is open.');
            var player = session.player;
            if (session.live) {
                renderSurfaceAdvanceFrame(player, 0);
                if (player.isPlaying) player.startRendering();
            } else {
                var seconds = Number(payload.seconds);
                if (!Number.isFinite(seconds) || seconds < session.time) throw new Error('Invalid export frame time.');
                var step = 1 / (session.options.simulation_fps || 60);
                var advanced = false;
                var batch = 0;
                // Preroll also advances Luau simulation; direct timeline scrubbing
                // alone does not reproduce a script's state at a segment start.
                while (session.time + 1e-8 < seconds) {
                    var dt = Math.min(step, seconds - session.time);
                    renderSurfaceAdvanceFrame(player, dt); session.time += dt; advanced = true;
                    if (++batch % 120 === 0) {
                        await new Promise(function (resolve) { setTimeout(resolve, 0); });
                        if (session.cancelled) throw new Error('Export cancelled.');
                    }
                }
                if (!advanced) renderSurfaceAdvanceFrame(player, 0);
            }
            return { frame_index: payload.frame_index, seconds: payload.seconds,
                png_base64: mediaCanvasPng(session.canvas, session.options, getRenderSurfaceMediaState().cursor) };
        }

        function closeRenderSurfaceMediaPlayer() {
            var state = getRenderSurfaceMediaState();
            if (state.export) {
                var live = state.export.live;
                state.export.cancelled = true;
                if (!state.export.live && state.export.player) state.export.player.cleanup();
                if (!state.export.live) state.export.canvas.remove();
                state.export = null;
                if (live) { handleResize(); renderSurfaceAdvanceFrame(riveInstance, 0); if (riveInstance.isPlaying) riveInstance.startRendering(); }
            }
            return { closed: true };
        }

        function handleRenderSurfaceMediaCommand(type, payload) {
            if (type === 'media-info') {
                var bounds = riveInstance.bounds;
                return { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY,
                    sourceIdentity: CONFIG.inspectionMetadata && CONFIG.inspectionMetadata.sourceIdentity,
                    playback: captureRenderSurfacePlayback() };
            }
            if (type === 'media-record-config') return configureMediaRecording(payload);
            if (type === 'media-open') return openRenderSurfaceMediaPlayer(payload);
            if (type === 'media-frame') return captureRenderSurfaceMediaFrame(payload);
            if (type === 'media-close') return closeRenderSurfaceMediaPlayer();
            if (type === 'media-record-start') return startRenderSurfaceRecording(payload);
            if (type === 'media-record-status') {
                var active = getRenderSurfaceMediaState().recording;
                return { recording: Boolean(active), interaction_schedule: active && active.schedule ? active.schedule.status() : null,
                    capture_clock: active && active.ownsClock ? { mode: 'fixed-step', max_lag_ms: active.maxLagMs || 0,
                        lag_ms: Math.max(0, performance.now() - active.start - (active.lastIndex + 1) * 1000 * active.options.fps.denominator / active.options.fps.numerator) } : null };
            }
            if (type === 'media-record-stop') return stopRenderSurfaceRecording();
            if (type === 'media-record-abort') return abortRenderSurfaceRecording(payload.capture_id);
            if (type === 'media-record-ack') {
                var recording = getRenderSurfaceMediaState().recording;
                if (recording && recording.id === payload.capture_id) {
                    var slot = recording.slots.find(function (entry) { return entry.index === payload.frame_index; });
                    if (slot) slot.index = null;
                }
                return { acknowledged: true };
            }
            throw new Error('Unknown media command: ' + type);
        }
