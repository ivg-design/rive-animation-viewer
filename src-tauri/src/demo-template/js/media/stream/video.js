        async function configureMediaRecording(options) {
            if (options.interactions && options.interactions.length
                && typeof validateRenderSurfaceInteractionAccessors === 'function') {
                validateRenderSurfaceInteractionAccessors(options.interactions, options.duration_seconds);
            }
            var codec = !options.alpha && ({ h264: 'h264', h265: 'hevc', webm: 'vp9' })[options.format];
            if (!codec || typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function'
                || typeof mediaCapturePipelineSupported !== 'function' || !mediaCapturePipelineSupported()) {
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
