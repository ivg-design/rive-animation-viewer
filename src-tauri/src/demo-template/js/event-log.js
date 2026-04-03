        function setupFullscreen() {
            const hint = els.fullscreenExitHint;
            if (!hint) return;

            let hoverTimer = null;

            document.addEventListener('keydown', function (e) {
                if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    const tag = (e.target.tagName || '').toLowerCase();
                    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
                    document.body.classList.toggle('fullscreen-mode');
                    handleResize();
                }
            });

            hint.addEventListener('click', function () {
                document.body.classList.remove('fullscreen-mode');
                handleResize();
            });

            // Show hint on hover in bottom-right corner
            document.addEventListener('mousemove', function (e) {
                if (!document.body.classList.contains('fullscreen-mode')) {
                    hint.style.opacity = '0';
                    return;
                }
                const threshold = 80;
                const inCorner = e.clientX > window.innerWidth - threshold && e.clientY > window.innerHeight - threshold;
                if (inCorner) {
                    if (!hoverTimer) {
                        hoverTimer = setTimeout(function () {
                            hint.style.opacity = '1';
                        }, 1000);
                    }
                } else {
                    clearTimeout(hoverTimer);
                    hoverTimer = null;
                    hint.style.opacity = '0';
                }
            });
        }

        /* ── Event log ───────────────────────────────────────── */

        function setupEventLog() {
            var nativeToggle = els.eventFilterNative;
            var riveUserToggle = els.eventFilterRiveUser;
            var uiToggle = els.eventFilterUi;
            var searchInput = els.eventFilterSearch;
            var clearButton = els.eventLogClearBtn;
            var header = els.eventLogHeader;
            var centerPanel = els.centerPanel;
            var eventLogPanel = els.eventLogPanel;
            var showEventLogBtn = els.showEventLogBtn;

            if (!nativeToggle || !riveUserToggle || !uiToggle || !searchInput || !clearButton) return;

            var syncToggle = function (element, active) {
                element.classList.toggle('is-active', active);
                element.setAttribute('aria-pressed', String(active));
            };

            syncToggle(nativeToggle, eventFilterState.native);
            syncToggle(riveUserToggle, eventFilterState.riveUser);
            syncToggle(uiToggle, eventFilterState.ui);
            searchInput.value = eventFilterState.search || '';

            nativeToggle.addEventListener('click', function () {
                eventFilterState.native = !eventFilterState.native;
                syncToggle(nativeToggle, eventFilterState.native);
                renderEventLog();
            });
            riveUserToggle.addEventListener('click', function () {
                eventFilterState.riveUser = !eventFilterState.riveUser;
                syncToggle(riveUserToggle, eventFilterState.riveUser);
                renderEventLog();
            });
            uiToggle.addEventListener('click', function () {
                eventFilterState.ui = !eventFilterState.ui;
                syncToggle(uiToggle, eventFilterState.ui);
                renderEventLog();
            });
            searchInput.addEventListener('input', function () {
                eventFilterState.search = searchInput.value.trim().toLowerCase();
                renderEventLog();
            });
            clearButton.addEventListener('click', function (e) {
                e.stopPropagation();
                resetEventLog();
                logEvent('ui', 'log-cleared', 'Event log cleared.');
            });

            if (header && centerPanel && eventLogPanel) {
                header.addEventListener('click', function (e) {
                    if (e.target.closest('.event-log-summary-right')) return;
                    var isCollapsed = centerPanel.classList.toggle('event-log-collapsed');
                    eventLogPanel.classList.toggle('collapsed', isCollapsed);
                    if (showEventLogBtn) showEventLogBtn.hidden = !isCollapsed;
                    handleResize();
                    setTimeout(handleResize, 250);
                });
            }

            if (showEventLogBtn && centerPanel && eventLogPanel) {
                showEventLogBtn.addEventListener('click', function () {
                    centerPanel.classList.remove('event-log-collapsed');
                    eventLogPanel.classList.remove('collapsed');
                    showEventLogBtn.hidden = true;
                    handleResize();
                    setTimeout(handleResize, 250);
                });
            }
        }

        function resetEventLog() {
            eventLogEntries.length = 0;
            eventLogSequence = 0;
            renderEventLog();
        }

        function logEvent(source, type, message, payload) {
            eventLogEntries.unshift({
                id: ++eventLogSequence,
                source: source,
                type: type,
                message: message,
                payload: payload,
                timestamp: Date.now(),
            });
            if (eventLogEntries.length > EVENT_LOG_LIMIT) {
                eventLogEntries.length = EVENT_LOG_LIMIT;
            }
            renderEventLog();
        }

        function renderEventLog() {
            var list = els.eventLogList;
            var count = els.eventLogCount;
            if (!list || !count) return;

            var filtered = eventLogEntries.filter(function (entry) {
                if (entry.source === 'native' && !eventFilterState.native) return false;
                if (entry.source === 'rive-user' && !eventFilterState.riveUser) return false;
                if (entry.source === 'ui' && !eventFilterState.ui) return false;
                if (eventFilterState.search) {
                    var haystack = (entry.source + ' ' + entry.type + ' ' + entry.message + ' ' + (entry.payload ? safeJson(entry.payload) : '')).toLowerCase();
                    if (!haystack.includes(eventFilterState.search)) return false;
                }
                return true;
            });

            count.textContent = String(filtered.length);
            list.innerHTML = '';

            if (!filtered.length) {
                var empty = document.createElement('p');
                empty.className = 'empty-state';
                empty.textContent = 'No events match current filters.';
                list.appendChild(empty);
                return;
            }

            filtered.forEach(function (entry) {
                var row = document.createElement('div');
                row.className = 'event-log-row';

                var time = document.createElement('span');
                time.className = 'event-row-time';
                time.textContent = formatEventTime(entry.timestamp);

                var source = document.createElement('span');
                source.className = 'event-row-kind ' + entry.source;
                source.textContent = entry.source === 'rive-user' ? 'USER' : entry.source.toUpperCase();

                var message = document.createElement('span');
                message.className = 'event-row-message';
                message.textContent = formatEventRowMessage(entry);
                message.title = message.textContent;

                row.appendChild(time);
                row.appendChild(source);
                row.appendChild(message);
                list.appendChild(row);
            });
        }

        function formatEventRowMessage(entry) {
            var parts = [];
            if (entry.type) parts.push(entry.type);
            if (entry.message && entry.message !== entry.type) parts.push(entry.message);
            if (entry.payload) {
                var p = entry.payload;
                if (typeof p === 'object' && p !== null) {
                    var keys = Object.keys(p).filter(function (k) { return k !== 'type' && k !== 'name'; });
                    if (keys.length) {
                        var vals = keys.map(function (k) {
                            var v = p[k];
                            if (typeof v === 'number') return k + ': ' + roundNum(v);
                            if (typeof v === 'string') return k + ': ' + v;
                            return k + ': ' + JSON.stringify(v);
                        });
                        parts.push(vals.join('  '));
                    }
                } else {
                    parts.push(String(p));
                }
            }
            return parts.join(' \u2022 ');
        }

        function roundNum(n) {
            if (Number.isInteger(n)) return String(n);
            return Number(n.toFixed(3)).toString();
        }

        function formatEventTime(timestamp) {
            var date = new Date(timestamp);
            var h = String(date.getHours()).padStart(2, '0');
            var m = String(date.getMinutes()).padStart(2, '0');
            var s = String(date.getSeconds()).padStart(2, '0');
            var cs = String(Math.floor(date.getMilliseconds() / 10)).padStart(2, '0');
            return h + ':' + m + ':' + s + '.' + cs;
        }

        function safeJson(value) {
            try {
                return JSON.stringify(value, null, 2);
            } catch (e) {
                return String(value);
            }
        }

        /* ── UI helpers ──────────────────────────────────────── */

        function updateInfo(message) {
            if (els.info) els.info.textContent = message;
        }

        function showError(message) {
            if (els.error) {
                els.error.textContent = message;
                els.error.classList.add('visible');
                if (errorTimeoutId) clearTimeout(errorTimeoutId);
                errorTimeoutId = setTimeout(hideError, 6000);
            }
        }

        function hideError() {
            if (els.error) {
                els.error.textContent = '';
                els.error.classList.remove('visible');
            }
            if (errorTimeoutId) {
                clearTimeout(errorTimeoutId);
                errorTimeoutId = null;
            }
        }

        function escapeHtml(str) {
            var div = document.createElement('div');
            div.appendChild(document.createTextNode(str));
            return div.innerHTML;
        }

        /* ── VM accessor helpers ─────────────────────────────── */

