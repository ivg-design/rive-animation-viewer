        function clearVmControlBindings() {
            vmControlBindings = [];
        }

        function captureVmControlSnapshot() {
            if (!vmControlBindings.length) return [];

            var snapshot = [];
            var seen = new Set();

            vmControlBindings.forEach(function (binding) {
                if (!binding || binding.kind === 'trigger') return;
                var descriptor = binding.descriptor || {};
                var key = (descriptor.source === 'state-machine'
                    ? 'sm:' + (descriptor.stateMachineName || '') + ':' + (descriptor.name || '') + ':' + (binding.kind || '')
                    : 'vm:' + (descriptor.path || '') + ':' + (binding.kind || ''));
                if (!key || seen.has(key)) return;

                var accessor = resolveControlAccessor(descriptor);
                if (!accessor || !('value' in accessor)) return;

                seen.add(key);
                snapshot.push({
                    descriptor: {
                        kind: descriptor.kind,
                        name: descriptor.name,
                        path: descriptor.path,
                        source: descriptor.source,
                        stateMachineName: descriptor.stateMachineName,
                    },
                    kind: binding.kind,
                    value: accessor.value,
                });
            });

            return snapshot;
        }

        function applyControlSnapshot(snapshot) {
            if (!Array.isArray(snapshot) || !snapshot.length) return 0;

            var applied = 0;
            snapshot.forEach(function (entry) {
                var descriptor = (entry && entry.descriptor) || {};
                var kind = entry && (entry.kind || descriptor.kind);
                if (!descriptor || !kind || kind === 'trigger') return;

                if (descriptor.source === 'state-machine') {
                    var stateMachineInput = resolveStateMachineInputAccessor(descriptor.stateMachineName, descriptor.name, kind);
                    if (stateMachineInput && 'value' in stateMachineInput) {
                        stateMachineInput.value = entry.value;
                        applied += 1;
                    }
                    return;
                }

                var accessor = resolveLiveAccessor(descriptor.path, kind);
                if (!accessor || !('value' in accessor)) return;
                accessor.value = entry.value;
                applied += 1;
            });

            return applied;
        }

        function registerVmControlBinding(descriptor, binding) {
            if (!descriptor || !binding) return;
            vmControlBindings.push({
                descriptor: {
                    path: descriptor.path,
                    name: descriptor.name,
                    kind: descriptor.kind,
                    source: descriptor.source,
                    stateMachineName: descriptor.stateMachineName,
                },
                kind: binding.kind,
                input: binding.input || null,
                colorInput: binding.colorInput || null,
                alphaInput: binding.alphaInput || null,
            });
        }

        function startVmControlSync() {
            if (vmControlSyncTimer || !vmControlBindings.length) return;
            vmControlSyncTimer = setInterval(function () {
                syncVmControlBindings(false);
            }, VM_CONTROL_SYNC_INTERVAL_MS);
        }

        function stopVmControlSync() {
            if (vmControlSyncTimer) {
                clearInterval(vmControlSyncTimer);
                vmControlSyncTimer = null;
            }
        }

        function isEditingControl(element) {
            return document.activeElement === element;
        }

        function syncVmControlBindings(force) {
            if (force === void 0) force = false;
            if (!vmControlBindings.length) return;

            vmControlBindings.forEach(function (binding) {
                var accessor = resolveControlAccessor(binding.descriptor);
                var canEdit = Boolean(accessor);

                if (binding.input) binding.input.disabled = !canEdit;
                if (binding.colorInput) binding.colorInput.disabled = !canEdit;
                if (binding.alphaInput) binding.alphaInput.disabled = !canEdit;
                if (!canEdit) return;

                if (binding.kind === 'number') {
                    var numValue = Number(accessor.value);
                    if (!Number.isFinite(numValue)) return;
                    if (!force && isEditingControl(binding.input)) return;
                    var nextNum = String(numValue);
                    if (binding.input.value !== nextNum) binding.input.value = nextNum;
                    return;
                }

                if (binding.kind === 'boolean') {
                    var nextBool = Boolean(accessor.value);
                    if (binding.input.checked !== nextBool) binding.input.checked = nextBool;
                    return;
                }

                if (binding.kind === 'string') {
                    var nextText = (typeof accessor.value === 'string') ? accessor.value : '';
                    if (!force && isEditingControl(binding.input)) return;
                    if (binding.input.value !== nextText) binding.input.value = nextText;
                    return;
                }

                if (binding.kind === 'enum') {
                    var nextEnum = (typeof accessor.value === 'string') ? accessor.value : '';
                    if (binding.input.value !== nextEnum) binding.input.value = nextEnum;
                    return;
                }

                if (binding.kind === 'color') {
                    var meta = argbToColorMeta(accessor.value);
                    if (!force && (isEditingControl(binding.colorInput) || isEditingControl(binding.alphaInput))) return;
                    if (binding.colorInput.value !== meta.hex) binding.colorInput.value = meta.hex;
                    var nextAlpha = String(meta.alphaPercent);
                    if (binding.alphaInput.value !== nextAlpha) binding.alphaInput.value = nextAlpha;
                }
            });
        }

        /* ── Color utilities ─────────────────────────────────── */

