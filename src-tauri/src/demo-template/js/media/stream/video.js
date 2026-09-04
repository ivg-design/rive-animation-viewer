        async function configureMediaRecording(options) {
            var codec = !options.alpha && ({ h264: 'h264', h265: 'hevc', webm: 'vp9' })[options.format];
            if (!codec || typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') {
                return { capture_codec: null, capture_transport: 'png-binary' };
            }
            var fps = options.fps.numerator / options.fps.denominator;
            var config = { codec: ({ h264: 'avc1.640034', hevc: 'hev1.1.6.L153.B0', vp9: 'vp09.00.51.08' })[codec],
                width: options.width, height: options.height, framerate: fps,
                bitrate: Math.round(Math.max(500000, Math.min(80000000, options.width * options.height * fps * (0.04 + options.quality * 0.0016)))),
                hardwareAcceleration: 'prefer-hardware', latencyMode: 'realtime' };
            if (codec === 'h264') config.avc = { format: 'annexb' };
            try {
                if ((await VideoEncoder.isConfigSupported(config)).supported) {
                    return { capture_codec: codec, encoder_config: config, capture_transport: 'webcodecs-binary' };
                }
            } catch (_) { /* Runtime capability is authoritative; retain lossless capture. */ }
            return { capture_codec: null, capture_transport: 'png-binary' };
        }

        function createMediaVideoWriter(options, onError) {
            var transport = createMediaBinaryTransport(options.native_job_id), packets = [], packetBytes = 0;
            var packetIndex = 0, config = null, error = null, lastFrame = null, lastIndex = -1;
            var warming = false;
            var encoded = 0, maxQueue = 0, fps = options.fps.numerator / options.fps.denominator;
            var outstanding = new Set();
            function fail(failure) { if (!error) { error = failure; onError(failure); } }
            function flushPackets() {
                if (!packets.length) return;
                var packet = mediaStreamPacket(packets); packets = []; packetBytes = 0;
                var write = transport.send(packetIndex++, packet).catch(fail).finally(function () { outstanding.delete(write); });
                outstanding.add(write);
            }
            var encoder = new VideoEncoder({
                output: function (chunk, metadata) {
                    try {
                        if (metadata && metadata.decoderConfig && metadata.decoderConfig.description && options.capture_codec !== 'vp9') {
                            config = mediaAnnexBConfig(metadata.decoderConfig.description, options.capture_codec);
                        }
                        if (warming) return;
                        var bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
                        if (options.capture_codec !== 'vp9') bytes = mediaAnnexBPacket(bytes, config, chunk.type === 'key');
                        packets.push(bytes); packetBytes += bytes.length + 4; encoded++;
                        if (packets.length >= 15 || packetBytes >= 1024 * 1024) flushPackets();
                    } catch (failure) { fail(failure); }
                }, error: fail,
            });
            encoder.configure(options.encoder_config);
            function submit(frame, index) {
                var timed = new VideoFrame(frame, { timestamp: Math.round(index * 1000000 / fps), duration: Math.round(1000000 / fps) });
                try { encoder.encode(timed, { keyFrame: index % Math.max(1, Math.round(fps * 2)) === 0 }); }
                finally { timed.close(); }
                maxQueue = Math.max(maxQueue, encoder.encodeQueueSize);
            }
            return {
                warmUp: async function (canvas) {
                    // Pay codec startup cost before recording time and interaction zero.
                    // Priming output is deliberately excluded from native packets/counts.
                    warming = true;
                    var prime = new VideoFrame(canvas, { timestamp: 0 });
                    try { encoder.encode(prime, { keyFrame: true }); await encoder.flush(); if (error) throw error; }
                    finally { prime.close(); warming = false; }
                },
                progress: function () { return encoded + ':' + (transport.progress ? transport.progress() : 0); },
                canAccept: function () { return !error && encoder.encodeQueueSize < 4 && (!transport.canAccept || transport.canAccept()); },
                frame: function (canvas, index) {
                    if (error) throw error;
                    if (index !== lastIndex + 1) throw new Error('Capture frame sequence is not contiguous; refusing to synthesize repeated frames.');
                    if (lastFrame) lastFrame.close();
                    lastFrame = new VideoFrame(canvas, { timestamp: Math.round(index * 1000000 / fps) });
                    submit(lastFrame, index); lastIndex = index;
                },
                finish: async function (count) {
                    try {
                        if (lastIndex + 1 !== count) throw new Error('Capture ended before every requested frame was rendered.');
                        await encoder.flush(); flushPackets(); await Promise.all(outstanding); await transport.drain();
                        if (error) throw error;
                        if (encoded !== count) throw new Error('Video encoder did not return every submitted frame.');
                        return { encoded_frames: encoded, repeated_frames: 0, max_encode_queue: maxQueue };
                    } finally { encoder.close(); if (lastFrame) { lastFrame.close(); lastFrame = null; } }
                },
                dispose: function () { transport.cancel(); if (encoder.state !== 'closed') encoder.close(); if (lastFrame) { lastFrame.close(); lastFrame = null; } },
            };
        }
