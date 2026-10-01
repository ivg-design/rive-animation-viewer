        function configureEmbeddedRiveRuntime(runtime, base64) {
            // Native render-surface payloads may use the ordinary runtime URL.
            // Standalone exports always supply verified matching WASM bytes.
            if (!base64) return;
            var loader = runtime && runtime.RuntimeLoader;
            if (!loader || typeof loader.setWasmUrl !== 'function') {
                throw new Error('This Rive runtime cannot load embedded WASM.');
            }
            var binary = atob(base64);
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            if (typeof loader.setWasmFallbackUrl === 'function') loader.setWasmFallbackUrl(null);
            if (typeof loader.setWasmBinary === 'function') {
                loader.setWasmBinary(bytes.buffer);
            } else {
                // Older selected runtimes expose only setWasmUrl. Data URLs
                // remain inside this one file and survive in-place resets.
                loader.setWasmUrl('data:application/wasm;base64,' + base64);
            }
        }

        configureEmbeddedRiveRuntime(window.rive || window.RiveModule, CONFIG.runtimeWasmBase64);
