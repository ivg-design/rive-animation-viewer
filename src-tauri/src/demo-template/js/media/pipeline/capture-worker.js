        // Capture worker: composes each rendered frame and encodes it off the
        // animation thread. The main thread only draws and hands over a GPU
        // ImageBitmap; composition, VideoFrame construction, VideoEncoder
        // work and PNG compression all run here, strictly in frame order.
        // Encoded bytes travel back as transferable buffers; the main thread
        // owns the native transport so the custom protocol origin stays the
        // WebView's own.
        function mediaCaptureWorker() {
            var config = null, canvas = null, ctx = null, encoder = null, annexConfig = null;
            var packets = [], packetBytes = 0, packetIndex = 0, encoded = 0, maxQueue = 0;
            var warming = false, failed = null, tail = Promise.resolve(), uploadPort = null;
            function post(message, transfer) { self.postMessage(message, transfer || []); }
            // Encoded bytes go straight to the uploader worker when a port was
            // supplied, so the animation thread never carries frame data.
            function deliver(message, transfer) {
                if (uploadPort) uploadPort.postMessage(message, transfer || []);
                else post(message, transfer);
            }
            function fail(error) {
                if (failed) return;
                failed = error;
                post({ type: 'error', message: String((error && error.message) || error) });
            }
            function flushPackets() {
                if (!packets.length) return;
                var packet = mediaStreamPacket(packets);
                packets = []; packetBytes = 0;
                deliver({ type: 'packet', index: packetIndex++, bytes: packet.buffer }, [packet.buffer]);
            }
            function ensureCanvas() {
                if (canvas && canvas.width === config.width && canvas.height === config.height) return;
                canvas = new OffscreenCanvas(config.width, config.height);
                ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('Capture worker could not create a 2D context.');
            }
            function compose(bitmap, cursor) {
                ensureCanvas();
                try {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    if (!config.alpha) {
                        ctx.fillStyle = config.background || '#000000';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                    }
                    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                } finally { bitmap.close(); }
                if (config.cursor && cursor && cursor.inside) {
                    ctx.save(); ctx.translate(cursor.x * canvas.width, cursor.y * canvas.height);
                    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, 20); ctx.lineTo(5, 15);
                    ctx.lineTo(10, 24); ctx.lineTo(14, 22); ctx.lineTo(9, 13); ctx.lineTo(17, 13); ctx.closePath();
                    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#000000'; ctx.lineWidth = 2;
                    ctx.fill(); ctx.stroke(); ctx.restore();
                }
            }
            function onChunk(chunk, metadata) {
                try {
                    if (metadata && metadata.decoderConfig && metadata.decoderConfig.description && config.codec !== 'vp9') {
                        annexConfig = mediaAnnexBConfig(metadata.decoderConfig.description, config.codec);
                    }
                    if (warming) return;
                    var bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
                    if (config.codec !== 'vp9') bytes = mediaAnnexBPacket(bytes, annexConfig, chunk.type === 'key');
                    packets.push(bytes); packetBytes += bytes.length + 4; encoded++;
                    post({ type: 'encoded', encoded: encoded, queue: encoder ? encoder.encodeQueueSize : 0 });
                    if (packets.length >= 15 || packetBytes >= 1024 * 1024) flushPackets();
                } catch (error) { fail(error); }
            }
            function configure(message) {
                config = message.config;
                uploadPort = message.uploadPort || null;
                if (!config || !(config.width > 0) || !(config.height > 0)) throw new Error('Capture worker requires output dimensions.');
                if (config.width * config.height > 4194304) throw new Error('Media canvas exceeds the four megapixel limit.');
                ensureCanvas();
                if (config.mode === 'video') {
                    if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') throw new Error('Video encoding is unavailable in the capture worker.');
                    encoder = new VideoEncoder({ output: onChunk, error: fail });
                    encoder.configure(config.encoder_config);
                }
                post({ type: 'configured' });
            }
            function encodeVideo(index, key) {
                var fps = config.fps;
                var frame = new VideoFrame(canvas, {
                    timestamp: Math.round(index * 1000000 / fps),
                    duration: Math.round(1000000 / fps),
                });
                try { encoder.encode(frame, { keyFrame: key }); }
                finally { frame.close(); }
                maxQueue = Math.max(maxQueue, encoder.encodeQueueSize);
            }
            function takeBitmap(message) {
                var bitmap = message.bitmap;
                message.bitmap = null;
                return bitmap;
            }
            async function frame(message) {
                var bitmap = takeBitmap(message);
                if (failed) { bitmap.close(); return; }
                compose(bitmap, message.cursor);
                var index = message.index;
                if (config.mode === 'video') {
                    encodeVideo(index, index % Math.max(1, Math.round(config.fps * 2)) === 0);
                    post({ type: 'accepted', index: index, queue: encoder.encodeQueueSize });
                    return;
                }
                var blob = await canvas.convertToBlob({ type: 'image/png' });
                if (blob.size > 20 * 1024 * 1024) throw new Error('Encoded frame exceeds the 20 MiB transport limit.');
                if (config.output === 'base64') {
                    post({ type: 'png', index: index, base64: new FileReaderSync().readAsDataURL(blob).split(',')[1] });
                    return;
                }
                var bytes = await blob.arrayBuffer();
                deliver({ type: 'png', index: index, bytes: bytes }, [bytes]);
                post({ type: 'compressed', index: index });
            }
            async function warm(message) {
                // Pay codec startup cost before recording time and interaction zero.
                // Priming output is deliberately excluded from native packets/counts.
                compose(takeBitmap(message), null);
                if (!encoder) { post({ type: 'warmed' }); return; }
                warming = true;
                var frame = new VideoFrame(canvas, { timestamp: 0 });
                try { encoder.encode(frame, { keyFrame: true }); await encoder.flush(); }
                finally { frame.close(); warming = false; }
                if (failed) throw failed;
                post({ type: 'warmed' });
            }
            async function finish() {
                if (encoder) {
                    await encoder.flush();
                    flushPackets();
                    encoder.close(); encoder = null;
                }
                if (uploadPort) uploadPort.postMessage({ type: 'end' });
                post({ type: 'finished', encoded: encoded, max_queue: maxQueue });
            }
            self.onmessage = function (event) {
                var message = event.data || {};
                // Every message is serialized so PNG completions and encoder
                // submissions keep frame order regardless of compression time.
                tail = tail.then(function () {
                    if (message.type === 'configure') return configure(message);
                    if (message.type === 'frame') return frame(message);
                    if (message.type === 'warm') return warm(message);
                    if (message.type === 'finish') return finish();
                    if (message.type === 'dispose') { if (encoder && encoder.state !== 'closed') encoder.close(); self.close(); }
                    return undefined;
                }).catch(function (error) {
                    if (message.bitmap && typeof message.bitmap.close === 'function') {
                        try { message.bitmap.close(); } catch (_) { /* noop */ }
                    }
                    fail(error);
                });
            };
        }

        // Uploader worker: owns the native transport. Receives encoded bytes from
        // capture workers over MessagePorts, restores frame order for PNG
        // captures (the native spool requires strictly increasing indices), and
        // reports acknowledgements to the main thread.
        function mediaUploadWorker() {
            var transport = null, ports = [], ended = 0, reorder = new Map(), nextIndex = 0;
            var queue = [], queuedBytes = 0, sending = false, delivered = 0, error = null, drainRequested = false;
            function post(message) { self.postMessage(message); }
            function fail(failure) {
                if (error) return;
                error = failure;
                post({ type: 'error', message: String((failure && failure.message) || failure), code: failure && failure.code, receipt: failure && failure.receipt });
            }
            function pending() { return queuedBytes + (transport ? transport.pendingBytes() : 0); }
            // One upload at a time keeps the transport's memory guard out of reach;
            // the main thread paces capture from the pending byte count instead.
            function pump() {
                if (sending || error || !queue.length) { maybeDrain(); return; }
                var next = queue.shift();
                queuedBytes -= next.bytes.byteLength;
                sending = true;
                transport.send(next.index, new Uint8Array(next.bytes)).then(function () {
                    sending = false;
                    delivered += 1;
                    post({ type: 'delivered', index: next.index, delivered: delivered, pending: pending() });
                    pump();
                }, function (failure) { sending = false; fail(failure); });
            }
            function enqueue(message) {
                queue.push(message);
                queuedBytes += message.bytes.byteLength;
                post({ type: 'queued', pending: pending() });
                pump();
            }
            function accept(message) {
                if (message.type === 'packet') { enqueue(message); return; }
                reorder.set(message.index, message);
                while (reorder.has(nextIndex)) {
                    var next = reorder.get(nextIndex);
                    reorder.delete(nextIndex);
                    nextIndex += 1;
                    enqueue(next);
                }
            }
            function maybeDrain() {
                if (!drainRequested || ended < ports.length || sending || queue.length || error) return;
                drainRequested = false;
                transport.drain().then(function () {
                    post({ type: 'drained', delivered: delivered });
                }, fail);
            }
            self.onmessage = function (event) {
                var message = event.data || {};
                if (message.type === 'configure') {
                    transport = createMediaBinaryTransport(message.jobId, function () {}, message.baseUrl);
                    ports = message.ports || [];
                    ports.forEach(function (port) {
                        port.onmessage = function (portEvent) {
                            var data = portEvent.data || {};
                            if (data.type === 'end') { ended += 1; maybeDrain(); return; }
                            accept(data);
                        };
                    });
                    post({ type: 'configured' });
                    return;
                }
                if (message.type === 'drain') { drainRequested = true; maybeDrain(); return; }
                if (message.type === 'dispose') { if (transport) transport.cancel(); self.close(); }
            };
        }

        function mediaCaptureWorkerSource() {
            return [mediaAnnexBConfig, mediaAnnexBPacket, mediaStreamPacket].map(function (helper) {
                return helper.toString();
            }).join('\n') + '\n(' + mediaCaptureWorker.toString() + ')();';
        }

        function mediaUploadWorkerSource() {
            return createMediaBinaryTransport.toString() + '\n(' + mediaUploadWorker.toString() + ')();';
        }
