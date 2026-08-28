        function reportRenderSurfaceLoadStage(stage, detail) {
            if (!isRenderSurfaceMode || typeof window.fetch !== 'function') return;
            var normalizedStage = String(stage || 'unknown').slice(0, 40);
            var normalizedDetail = String(detail || '').slice(0, 160);
            var query = 'phase=load-stage-' + encodeURIComponent(normalizedStage)
                + '&available=1&listen=1&emitTo=1&emit=1'
                + (normalizedDetail ? '&detail=' + encodeURIComponent(normalizedDetail) : '');
            Promise.resolve(window.fetch('/__rav-render-surface-bridge?' + query, {
                cache: 'no-store',
            })).catch(function () { /* diagnostic only */ });
        }
