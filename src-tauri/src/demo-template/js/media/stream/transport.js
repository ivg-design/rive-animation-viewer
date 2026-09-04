        function createMediaBinaryTransport(jobId) {
            var acknowledged = 0, pendingBytes = 0, tail = Promise.resolve(), error = null, controller = new AbortController();
            return {
                progress: function () { return acknowledged; },
                // Leave room for in-flight encoder callbacks and their packets.
                canAccept: function () { return !error && pendingBytes < 8 * 1024 * 1024; },
                send: function (index, bytes) {
                    if (error) return Promise.reject(error);
                    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
                    if (bytes.length > 20 * 1024 * 1024 || pendingBytes + bytes.length > 32 * 1024 * 1024) {
                        error = new Error('Capture cannot keep up with disk writes. Recording stopped to protect memory.');
                        return Promise.reject(error);
                    }
                    pendingBytes += bytes.length;
                    var request = tail.then(async function () {
                        if (error) throw error;
                        var timer = setTimeout(function () { controller.abort(); }, 15000);
                        var response;
                        try { response = await fetch('/__rav-media/' + encodeURIComponent(jobId) + '/' + index,
                            { method: 'POST', body: bytes, signal: controller.signal, cache: 'no-store',
                                headers: { 'Content-Type': 'application/octet-stream' } }); }
                        finally { clearTimeout(timer); }
                        if (!response.ok) throw new Error(await response.text() || 'Capture disk write failed.');
                        var receipt = await response.json();
                        if (receipt.stop_reason === 'disk_space') {
                            var stop = new Error('Recording stopped at the available disk-space limit.');
                            stop.code = 'disk_space'; stop.receipt = receipt; throw stop;
                        }
                        acknowledged++;
                        return receipt;
                    }).finally(function () { pendingBytes -= bytes.length; });
                    tail = request.catch(function (failure) { error = failure; });
                    return request;
                },
                drain: async function () { await tail; if (error) throw error; },
                cancel: function () { controller.abort(); },
            };
        }
