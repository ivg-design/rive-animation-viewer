        function setupRenderSurfaceBridge() {
            var events = window.__TAURI__ && window.__TAURI__.event;
            var protocolVersion = 2, commandChain = Promise.resolve(), lastCommandRevision = 0;
            var readyRetryDelays = [0, 100, 300, 750, 1500, 3000, 6000];
            var readyRetryTimers = [], parentReadyAcknowledged = false;
            var eventApi = {
                available: Boolean(events),
                listen: Boolean(events && typeof events.listen === 'function'),
                emitTo: Boolean(events && typeof events.emitTo === 'function'),
                emit: Boolean(events && typeof events.emit === 'function'),
            };
            // Canonical discovery can traverse hundreds of live WASM accessors.
            // Keep it outside the child readiness and activation transactions;
            // the prepare-frame receipt enables it after the candidate is ready
            // to become visible.
            window.__ravRenderSurfaceDefersCanonical = true;
            // This tiny same-origin probe is only a startup diagnostic. It
            // provides a native receipt if the injected event facade is absent
            // or rejects an outbound event; it is not a general IPC channel.
            var reportBridgeProbe = function (phase) {
                if (typeof window.fetch !== 'function') return;
                var query = [
                    'phase=' + encodeURIComponent(String(phase || 'unknown').slice(0, 32)),
                    'available=' + (eventApi.available ? '1' : '0'),
                    'listen=' + (eventApi.listen ? '1' : '0'),
                    'emitTo=' + (eventApi.emitTo ? '1' : '0'),
                    'emit=' + (eventApi.emit ? '1' : '0'),
                ].join('&');
                Promise.resolve(window.fetch('/__rav-render-surface-bridge?' + query, { cache: 'no-store' })).catch(function () { /* best effort diagnostic */ });
            };
            var encodeStartupPayload = function (payload) {
                try {
                    var utf8 = encodeURIComponent(JSON.stringify(payload)).replace(
                        /%([0-9A-F]{2})/g,
                        function (_match, byte) { return String.fromCharCode(parseInt(byte, 16)); },
                    );
                    return window.btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                } catch (_error) {
                    return null;
                }
            };
            // Tauri's targeted event promise can resolve even when the native
            // main WebView never observes the event. Critical, bounded startup
            // receipts therefore also cross the already-proven custom protocol.
            // ACK/state/metrics deliberately remain on the canonical event IPC.
            var reportStartupReceipt = function (eventName, payload) {
                if (typeof window.fetch !== 'function') return Promise.resolve(false);
                var startupEvent = ({
                    'render-surface:error': 'error',
                    'render-surface:loaded': 'loaded',
                    'render-surface:ready': 'ready',
                })[eventName];
                var isFatalStartupError = startupEvent === 'error'
                    && payload && payload.recoverable !== true
                    && ['listen', 'load', 'load-listen'].indexOf(payload.phase) >= 0;
                if (!startupEvent || (startupEvent === 'error' && !isFatalStartupError)) {
                    return Promise.resolve(false);
                }
                var encodedPayload = encodeStartupPayload(payload);
                if (!encodedPayload || encodedPayload.length > 4096) return Promise.resolve(false);
                var url = '/__rav-render-surface-startup-receipt?event=' + startupEvent
                    + '&payload=' + encodedPayload;
                return Promise.resolve(window.fetch(url, { cache: 'no-store' })).then(
                    function () { return true; },
                    function () { return false; },
                );
            };
            var emitToMain = function (eventName, payload) {
                var eventPayload = Object.assign({ sessionId: renderSurfaceSessionId }, payload || {});
                var emitFallback = function () {
                    if (!eventApi.emit) return Promise.resolve(false);
                    return Promise.resolve(events.emit(eventName, eventPayload)).then(
                        function () { return true; },
                        function () { reportBridgeProbe('emit-rejected'); return false; },
                    );
                };
                var nativeReceipt = reportStartupReceipt(eventName, eventPayload);
                var eventReceipt = !eventApi.emitTo ? emitFallback() : Promise.resolve(events.emitTo('main', eventName, eventPayload)).then(
                    function () { return true; },
                    function () { reportBridgeProbe('emit-to-rejected'); return emitFallback(); },
                );
                return Promise.all([eventReceipt, nativeReceipt]).then(function (receipts) {
                    return receipts[0] || receipts[1];
                });
            };
            window.__ravRenderSurfaceEmit = emitToMain;
            document.addEventListener('pointerdown', function (event) {
                void emitToMain('render-surface:pointerdown', {
                    pointerType: event.pointerType || 'unknown',
                });
            }, { capture: true, passive: true });
            reportBridgeProbe(eventApi.listen ? 'boot' : 'event-api-missing');
            if (!eventApi.listen) return;
            var announceReady = function (reason, attempt) {
                return emitToMain('render-surface:ready', {
                    attempt: attempt,
                    handshake: parentReadyAcknowledged ? 'acknowledged' : 'pending',
                    protocol: protocolVersion,
                    protocolVersion: protocolVersion,
                    reason: reason,
                });
            };
            // Ready is replayed for a fixed six-second window. The parent must
            // acknowledge it with render-surface:load for this session.
            readyRetryDelays.forEach(function (delay, attempt) {
                var timer = window.setTimeout(function () {
                    if (parentReadyAcknowledged) return;
                    announceReady('retry', attempt);
                    if (attempt > 0) reportBridgeProbe('ready-retry');
                }, delay);
                readyRetryTimers.push(timer);
            });
            events.listen('render-surface:load', function (event) {
                var payload = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
                if (payload.sessionId && renderSurfaceSessionId && payload.sessionId !== renderSurfaceSessionId) return;
                // Parent listeners can receive an already queued ready beacon.
                // A second load for the same session must be idempotent or the
                // acknowledged ready receipt feeds back into an infinite loop.
                if (parentReadyAcknowledged) return;
                parentReadyAcknowledged = true;
                readyRetryTimers.forEach(function (timer) { window.clearTimeout(timer); });
                readyRetryTimers = [];
                reportBridgeProbe('parent-ready-ack');
                announceReady('parent-ready-ack', -1);
            }).catch(function (error) {
                reportBridgeProbe('load-listen-rejected');
                emitToMain('render-surface:error', { phase: 'load-listen', message: String((error && error.message) || error) });
            });
            events.listen('render-surface:command', function (event) {
                var command = event && event.payload && typeof event.payload === 'object' ? event.payload : {};
                if (command.sessionId && renderSurfaceSessionId && command.sessionId !== renderSurfaceSessionId) return;
                commandChain = commandChain.then(function () {
                    if (Number(command.protocolVersion || protocolVersion) !== protocolVersion) throw new Error('Unsupported render-surface protocol version.');
                    var commandRevision = Number(command.revision) || 0;
                    if (commandRevision <= lastCommandRevision) throw new Error('Stale render-surface command revision.');
                    return Promise.resolve(handleRenderSurfaceCommand(command, emitToMain));
                }).then(function (result) {
                    lastCommandRevision = Number(command.revision) || lastCommandRevision;
                    // Scalar, trigger, and image mutations carry an O(1)
                    // canonical delta. Never place a full 999-control scan in
                    // front of the receipt: the parent timeout is measuring
                    // whether the child applied the command, not how long a
                    // complete observer sweep happens to take.
                    var canonicalState = captureRenderSurfaceCommandCanonicalDelta(command, result);
                    return emitToMain('render-surface:ack', {
                        applied: true,
                        commandId: command.commandId || null,
                        canonicalDelta: canonicalState,
                        protocolVersion: protocolVersion,
                        requestedRevision: Number(command.revision) || 0,
                        revision: canonicalState ? canonicalState.stateRevision : 0,
                        result: result || null,
                        status: 'applied',
                    }).then(function (emitted) {
                        // `prepare-frame` is the final child-side presentation
                        // fence. Only after its applied receipt is transported
                        // may the eventual topology/value snapshot begin. This
                        // keeps first-frame activation and every activation ACK
                        // independent of a 999-control discovery pass.
                        var commandType = String(command.type || command.command || '').toLowerCase();
                        if (emitted && commandType === 'prepare-frame') {
                            scheduleRenderSurfaceInitialCanonicalState();
                        } else if (emitted && commandType === 'reset') {
                            scheduleRenderSurfaceCanonicalRefresh('reset-first-frame', true);
                        }
                        return emitted;
                    });
                }).catch(function (error) {
                    return emitToMain('render-surface:ack', {
                        applied: false,
                        commandId: command.commandId || null,
                        message: String((error && error.message) || error),
                        protocolVersion: protocolVersion,
                        recoverable: true,
                        requestedRevision: Number(command.revision) || 0,
                        status: 'rejected',
                    });
                });
            }).catch(function (error) {
                emitToMain('render-surface:error', { phase: 'listen', message: String((error && error.message) || error) });
            });
        }
