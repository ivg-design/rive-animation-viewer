        // Main-thread side of the capture pipeline. Per frame it costs one GPU
        // ImageBitmap snapshot (resized to the output on the GPU) and one
        // postMessage. Composition, encoding, PNG compression and the native
        // upload all happen in workers: capture workers hand encoded bytes to an
        // uploader worker over MessagePorts, so multi-megabyte frames never pass
        // through the animation thread. Back-pressure is explicit: bounded
        // in-flight frames, the encoder queue reported by the worker, and the
        // uploader's pending byte budget.
        // Video runs one capture worker (a single VideoEncoder keeps timestamps
        // ordered). PNG compression parallelises across workers; the uploader
        // restores index order because the native spool requires it.
        // PNG compression scales with cores. WebKit reports at most 8, so a
        // report of 8 usually means more; use the full 8 then, otherwise leave
        // two cores for the renderer and the uploader (minimum two workers).
        function mediaCapturePngWorkerCount() {
            var override = typeof window !== 'undefined' && Number(window.__ravCapturePngWorkers);
            if (override >= 1 && override <= 8) return Math.floor(override);
            var cores = Number((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4);
            return Math.max(2, Math.min(4, cores - 2));
        }
        var MEDIA_CAPTURE_MAX_ENCODER_QUEUE = 4;
        var MEDIA_CAPTURE_MAX_PENDING_UPLOAD_BYTES = 8 * 1024 * 1024;

        function mediaCapturePipelineSupported() {
            return typeof Worker === 'function' && typeof OffscreenCanvas === 'function'
                && typeof createImageBitmap === 'function' && typeof MessageChannel === 'function';
        }

        function createMediaCapturePipeline(options, hooks) {
            hooks = hooks || {};
            var mode = options.capture_codec ? 'video' : 'png';
            var binary = Boolean(options.native_job_id);
            var workers = [], uploader = null, urls = [], error = null, disposed = false;
            var workerCount = mode === 'video' ? 1 : mediaCapturePngWorkerCount();
            var maxInflight = workerCount + 2;
            var inflight = 0, submitted = 0, delivered = 0, encoded = 0, lastQueue = 0, pendingUpload = 0;
            var waiters = [], pending = {}, deliveries = new Set(), resizeSupported = true;
            var config = {
                mode: mode, codec: options.capture_codec || null, encoder_config: options.encoder_config || null,
                width: options.width, height: options.height, alpha: Boolean(options.alpha),
                background: options.background || '#000000', cursor: Boolean(options.cursor),
                fps: options.fps.numerator / options.fps.denominator,
                output: binary ? 'binary' : 'base64',
            };
            function notify() {
                var list = waiters; waiters = [];
                list.forEach(function (resolve) { resolve(); });
            }
            function fail(failure) {
                if (error) return;
                error = failure instanceof Error ? failure : new Error(String(failure));
                notify();
                Object.keys(pending).forEach(function (type) { settle(type, null, error); });
                if (hooks.onError) hooks.onError(error);
            }
            // Phase replies arrive once per worker; a phase settles when every
            // expected worker has answered (or as soon as anything fails).
            function expect(type, count) {
                return new Promise(function (resolve, reject) {
                    pending[type] = { resolve: resolve, reject: reject, remaining: count, value: null };
                });
            }
            function settle(type, value, failure) {
                var entry = pending[type];
                if (!entry) return;
                if (failure) { delete pending[type]; entry.reject(failure); return; }
                entry.remaining -= 1;
                if (value && (!entry.value || (value.encoded || 0) >= (entry.value.encoded || 0))) entry.value = value;
                if (entry.remaining > 0) return;
                delete pending[type];
                entry.resolve(entry.value || value);
            }
            function track(promise) {
                var write = promise.catch(fail).finally(function () { deliveries.delete(write); notify(); });
                deliveries.add(write);
            }
            function onCaptureMessage(event) {
                var message = event.data || {};
                if (message.type === 'accepted') { inflight--; lastQueue = message.queue || 0; notify(); return; }
                if (message.type === 'compressed') { inflight--; notify(); return; }
                if (message.type === 'encoded') { encoded = message.encoded; lastQueue = message.queue || 0; notify(); return; }
                if (message.type === 'png') {
                    // Base64 route only: the uploader receives binary frames directly.
                    inflight--;
                    if (!hooks.emitFrame) { fail(new Error('No frame delivery route is available.')); return; }
                    track(Promise.resolve(hooks.emitFrame(message.index, message.base64)).then(function () { delivered++; }));
                    notify();
                    return;
                }
                if (message.type === 'error') { fail(new Error(message.message || 'Capture worker failed.')); return; }
                if (message.type === 'configured' || message.type === 'warmed' || message.type === 'finished') settle(message.type, message);
            }
            function onUploadMessage(event) {
                var message = event.data || {};
                if (message.type === 'queued') { pendingUpload = message.pending || 0; notify(); return; }
                if (message.type === 'delivered') {
                    delivered = message.delivered;
                    pendingUpload = message.pending || 0;
                    notify();
                    if (hooks.onProgress) hooks.onProgress();
                    return;
                }
                if (message.type === 'error') {
                    var failure = new Error(message.message || 'Capture upload failed.');
                    if (message.code) failure.code = message.code;
                    if (message.receipt) failure.receipt = message.receipt;
                    fail(failure);
                    return;
                }
                if (message.type === 'configured' || message.type === 'drained') settle('upload-' + message.type, message);
            }
            var sourceUrls = new Map();
            function spawn(source, onmessage, name) {
                var url = sourceUrls.get(source);
                if (!url) {
                    url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
                    sourceUrls.set(source, url); urls.push(url);
                }
                var worker = new Worker(url, { name: name });
                worker.onmessage = onmessage;
                worker.onerror = function (event) { fail(new Error(event.message || (name + ' failed.'))); };
                worker.onmessageerror = function () { fail(new Error('Could not receive a ' + name + ' message.')); };
                return worker;
            }
            function ensureWorkers() {
                if (workers.length) return workers;
                if (!mediaCapturePipelineSupported()) throw new Error('Capture worker support is unavailable.');
                try {
                    var source = mediaCaptureWorkerSource();
                    for (var i = 0; i < workerCount; i += 1) workers.push(spawn(source, onCaptureMessage, 'rav-capture-' + i));
                    if (binary) uploader = spawn(mediaUploadWorkerSource(), onUploadMessage, 'rav-capture-upload');
                } catch (failure) {
                    teardown();
                    throw failure;
                }
                return workers;
            }
            function teardown() {
                workers.forEach(function (worker) {
                    try { worker.postMessage({ type: 'dispose' }); } catch (_) { /* noop */ }
                    worker.terminate();
                });
                workers = [];
                if (uploader) {
                    try { uploader.postMessage({ type: 'dispose' }); } catch (_) { /* noop */ }
                    uploader.terminate(); uploader = null;
                }
                urls.forEach(function (url) { URL.revokeObjectURL(url); });
                urls = []; sourceUrls.clear();
            }
            function postTo(index, message, transfer) {
                if (disposed) throw new Error('Capture pipeline is closed.');
                var list = ensureWorkers();
                list[index % list.length].postMessage(message, transfer || []);
            }
            function snapshot(canvas) {
                // Resize on the GPU so the worker never receives more pixels than
                // the output; a live preview canvas is often denser than the file.
                if (resizeSupported && (canvas.width !== config.width || canvas.height !== config.height)) {
                    return createImageBitmap(canvas, {
                        resizeWidth: config.width, resizeHeight: config.height, resizeQuality: 'high',
                    }).catch(function (failure) {
                        if (!(failure instanceof TypeError)) throw failure;
                        resizeSupported = false;
                        return createImageBitmap(canvas);
                    });
                }
                return createImageBitmap(canvas);
            }
            return {
                mode: mode,
                configure: async function () {
                    var list = ensureWorkers();
                    var ready = expect('configured', list.length);
                    var uploaderReady = uploader ? expect('upload-configured', 1) : Promise.resolve();
                    var channels = uploader ? list.map(function () { return new MessageChannel(); }) : [];
                    if (uploader) {
                        uploader.postMessage({
                            type: 'configure', jobId: options.native_job_id,
                            baseUrl: typeof location !== 'undefined' ? location.origin : '',
                            ports: channels.map(function (channel) { return channel.port2; }),
                        }, channels.map(function (channel) { return channel.port2; }));
                    }
                    list.forEach(function (worker, index) {
                        var port = channels[index] ? channels[index].port1 : null;
                        worker.postMessage({ type: 'configure', config: config, uploadPort: port }, port ? [port] : []);
                    });
                    await uploaderReady;
                    return ready;
                },
                warmUp: async function (canvas) {
                    var list = ensureWorkers();
                    var warmed = expect('warmed', list.length);
                    for (var i = 0; i < list.length; i += 1) {
                        var bitmap = await snapshot(canvas);
                        postTo(i, { type: 'warm', bitmap: bitmap }, [bitmap]);
                    }
                    return warmed;
                },
                canAccept: function () {
                    return !error && !disposed && inflight < maxInflight
                        && lastQueue < MEDIA_CAPTURE_MAX_ENCODER_QUEUE
                        && pendingUpload < MEDIA_CAPTURE_MAX_PENDING_UPLOAD_BYTES;
                },
                whenReady: function (timeoutMs) {
                    return new Promise(function (resolve) {
                        var timer = setTimeout(resolve, timeoutMs == null ? 8 : timeoutMs);
                        waiters.push(function () { clearTimeout(timer); resolve(); });
                    });
                },
                // Snapshot synchronously with the draw that produced the frame;
                // the promise only carries the handle across the thread boundary.
                capture: function (canvas, index, cursor) {
                    if (error) throw error;
                    if (disposed) throw new Error('Capture pipeline is closed.');
                    inflight++; submitted++;
                    var cursorState = { x: cursor && cursor.x, y: cursor && cursor.y, inside: Boolean(cursor && cursor.inside) };
                    snapshot(canvas).then(function (image) {
                        try { postTo(index, { type: 'frame', index: index, bitmap: image, cursor: cursorState }, [image]); }
                        catch (failure) { image.close(); fail(failure); }
                    }, fail);
                    return true;
                },
                finish: async function (count) {
                    if (error) throw error;
                    var finished = expect('finished', workers.length);
                    workers.forEach(function (worker) { worker.postMessage({ type: 'finish' }); });
                    var receipt = await finished;
                    if (uploader) {
                        var drained = expect('upload-drained', 1);
                        uploader.postMessage({ type: 'drain' });
                        await drained;
                    }
                    await Promise.all(Array.from(deliveries));
                    if (error) throw error;
                    if (mode === 'video') {
                        if (receipt.encoded !== count) throw new Error('Video encoder did not return every submitted frame.');
                        return { encoded_frames: receipt.encoded, repeated_frames: 0, max_encode_queue: receipt.max_queue || 0 };
                    }
                    if (delivered !== count) throw new Error('Capture ended before every requested frame was delivered.');
                    return null;
                },
                progress: function () { return encoded + ':' + delivered + ':' + pendingUpload; },
                submitted: function () { return submitted; },
                workerCount: function () { return workerCount; },
                dispose: function () {
                    if (disposed) return;
                    disposed = true;
                    teardown();
                    var closed = new Error('Capture pipeline closed.');
                    Object.keys(pending).forEach(function (type) { settle(type, null, closed); });
                    notify();
                },
            };
        }
