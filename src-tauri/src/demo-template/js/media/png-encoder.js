        // WebKit's HTMLCanvasElement.toBlob can compress synchronously before
        // returning. Move recording PNG compression off the animation thread.
        // There are three slots, each holding at most one capture through ACK.
        function mediaPngWorker() {
            var canvas;
            self.onmessage = async function (event) {
                var bitmap = event.data.bitmap || event.data, binary = event.data.binary === true;
                try {
                    if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
                        canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                    }
                    var ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(bitmap, 0, 0);
                    bitmap.close(); bitmap = null;
                    var blob = await canvas.convertToBlob({ type: 'image/png' });
                    if (blob.size > 20 * 1024 * 1024) throw new Error('Encoded frame exceeds the 20 MiB transport limit.');
                    if (binary) {
                        var bytes = await blob.arrayBuffer(); self.postMessage({ png: bytes }, [bytes]);
                    } else {
                        var data = new FileReaderSync().readAsDataURL(blob).split(',')[1];
                        self.postMessage({ png: data });
                    }
                } catch (error) {
                    self.postMessage({ error: String(error.message || error) });
                } finally { if (bitmap) bitmap.close(); }
            };
        }

        function createMediaRecordingSlots(binary) {
            var slots = [];
            var supported = typeof Worker === 'function' && typeof OffscreenCanvas === 'function'
                && typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function';
            if (supported) {
                try {
                    for (var i = 0; i < 3; i++) slots.push(createMediaPngWorkerSlot(binary));
                    return slots;
                } catch (_) { slots.forEach(function (slot) { slot.dispose(); }); }
            }
            // Older WebViews keep the bounded asynchronous API. Receipts still
            // report held frames when the fallback cannot sustain the target FPS.
            return [0, 1, 2].map(function () {
                return { index: null, canvas: document.createElement('canvas'), dispose: function () {} };
            });
        }

        function createMediaPngWorkerSlot(binary) {
            var canvas = new OffscreenCanvas(1, 1);
            var url = URL.createObjectURL(new Blob(['(' + mediaPngWorker.toString() + ')()'], { type: 'text/javascript' }));
            var worker;
            try { worker = new Worker(url); }
            catch (error) { URL.revokeObjectURL(url); throw error; }
            var pending = null, disposed = false;
            function settle(error, png) {
                if (!pending) return;
                var request = pending; pending = null; clearTimeout(request.timer);
                if (error) request.reject(error); else request.resolve(png);
            }
            worker.onmessage = function (event) {
                settle(event.data.error ? new Error(event.data.error) : null, event.data.png);
            };
            worker.onerror = function (event) { settle(new Error(event.message || 'PNG worker failed.')); };
            worker.onmessageerror = function () { settle(new Error('Could not receive the encoded frame.')); };
            return {
                index: null, canvas: canvas,
                encode: function (bitmap) {
                    if (disposed || pending) { bitmap.close(); return Promise.reject(new Error('PNG worker is unavailable.')); }
                    return new Promise(function (resolve, reject) {
                        pending = { resolve: resolve, reject: reject,
                            timer: setTimeout(function () { settle(new Error('PNG encoding timed out.')); }, 10000) };
                        try { worker.postMessage(binary ? { bitmap: bitmap, binary: true } : bitmap, [bitmap]); }
                        catch (error) { bitmap.close(); settle(error); }
                    });
                },
                dispose: function () {
                    if (disposed) return;
                    disposed = true;
                    settle(new Error('PNG encoder closed.'));
                    worker.terminate(); URL.revokeObjectURL(url);
                },
            };
        }
