        function disposeRenderSurface() {
            if (!isRenderSurfaceMode || window.__ravRenderSurfaceDisposed) return false;
            window.__ravRenderSurfaceDisposed = true;
            renderSurfaceQuiesced = true;
            window.__ravNativeFrameTick = null;
            window.removeEventListener('resize', handleResize);
            if (canvasResizeObserver) {
                try { canvasResizeObserver.disconnect(); } catch (e) { /* noop */ }
                canvasResizeObserver = null;
            }
            try {
                var mediaState = typeof getRenderSurfaceMediaState === 'function'
                    ? getRenderSurfaceMediaState()
                    : null;
                if (mediaState && (mediaState.recording || mediaState.preparing)
                    && typeof abortRenderSurfaceRecording === 'function') {
                    abortRenderSurfaceRecording();
                }
            } catch (e) { /* native retirement cannot wait on media cleanup */ }
            cleanupInstance();
            if (typeof window.__ravDisposeRenderSurfaceBridge === 'function') {
                window.__ravDisposeRenderSurfaceBridge();
            }
            return true;
        }

        if (isRenderSurfaceMode) {
            window.__ravDisposeRenderSurface = disposeRenderSurface;
            window.addEventListener('pagehide', disposeRenderSurface, { once: true });
            window.addEventListener('beforeunload', disposeRenderSurface, { once: true });
        }
