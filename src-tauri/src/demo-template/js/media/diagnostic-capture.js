        function captureRenderSurfaceDiagnostic(payload, emitToMain) {
                var requestId = payload.requestId;
                if (!requestId) throw new Error('Render-surface capture request is missing requestId');
                try {
                    var canvas = els.canvas;
                    if (!canvas || canvas.width <= 0 || canvas.height <= 0) throw new Error('Rendered canvas has zero pixel dimensions');
                    if (!riveInstance || typeof riveInstance.drawFrame !== 'function') throw new Error('The active Rive runtime cannot refresh the rendered frame for capture');
                    // Fence the playback RAF: drawFrame() may otherwise be a no-op during playback.
                    var canFenceRenderLoop = typeof riveInstance.stopRendering === 'function' && typeof riveInstance.startRendering === 'function';
                    var canForceDraw = 'drawOptimization' in riveInstance, previousDrawOptimization = canForceDraw ? riveInstance.drawOptimization : null;
                    if (canFenceRenderLoop) riveInstance.stopRendering();
                    try {
                        if (canForceDraw) riveInstance.drawOptimization = 'alwaysDraw'; riveInstance.drawFrame();
                    } finally {
                        if (canForceDraw) riveInstance.drawOptimization = previousDrawOptimization; if (canFenceRenderLoop) riveInstance.startRendering();
                    }
                    var backgroundColor = '';
                    try { backgroundColor = window.getComputedStyle(canvas).backgroundColor || ''; } catch (error) { /* noop */ }
                    if (!backgroundColor) backgroundColor = canvas.style.backgroundColor || canvas.style.background || '';
                    var normalizedBackground = String(backgroundColor || '').trim().toLowerCase().replace(/\s+/g, '');
                    var compositeBackground = Boolean(normalizedBackground && normalizedBackground !== 'transparent' && normalizedBackground !== 'rgba(0,0,0,0)' && normalizedBackground !== 'hsla(0,0%,0%,0)');
                    var originalWidth = canvas.width, originalHeight = canvas.height, scale = Math.min(1, Math.sqrt(2000000 / (originalWidth * originalHeight)));
                    var data = '', output = null, attempts = 0;
                    for (attempts = 1; attempts <= 4; attempts += 1) {
                        output = document.createElement('canvas');
                        output.width = Math.max(1, Math.floor(originalWidth * scale)); output.height = Math.max(1, Math.floor(originalHeight * scale));
                        var context = output.getContext('2d'); if (!context) throw new Error('A 2D canvas is required to encode the rendered screenshot');
                        if (compositeBackground) { context.fillStyle = backgroundColor; context.fillRect(0, 0, output.width, output.height); }
                        else context.clearRect(0, 0, output.width, output.height);
                        context.drawImage(canvas, 0, 0, output.width, output.height);
                        var dataUrl = output.toDataURL('image/png');
                        var prefix = 'data:image/png;base64,';
                        if (typeof dataUrl !== 'string' || dataUrl.indexOf(prefix) !== 0) throw new Error('Rendered canvas did not produce PNG image data');
                        data = dataUrl.slice(prefix.length);
                        if (data && data.length <= 12 * 1024 * 1024) break;
                        if (attempts < 4) scale *= Math.min(0.75, Math.sqrt((12 * 1024 * 1024) / Math.max(1, data.length)) * 0.9);
                    }
                    if (!data || data.length > 12 * 1024 * 1024) throw new Error('Rendered canvas PNG exceeds the 12 MiB transport limit after 4 attempts');
                    emitToMain('render-surface:capture', { requestId: requestId, result: {
                        image: { mimeType: 'image/png', encoding: 'base64', data: data },
                        metadata: { source: '#rive-canvas', originalWidth: originalWidth, originalHeight: originalHeight,
                            width: output.width, height: output.height, scale: output.width / originalWidth,
                            downscaled: output.width !== originalWidth || output.height !== originalHeight,
                            background: { color: backgroundColor || 'transparent', composited: compositeBackground },
                            captureAttempts: attempts, pngByteLength: Math.max(0, Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0)),
                            transportBase64Limit: 12 * 1024 * 1024, renderer: CONFIG.runtimeName || 'unknown',
                            runtimeVersion: CONFIG.runtimeVersion || 'unknown', frameRefreshed: true,
                            captureSurface: 'isolated-render-surface' },
                    } });
                } catch (error) {
                    emitToMain('render-surface:capture', { requestId: requestId, error: String((error && error.message) || error) });
                }
                return;
        }
