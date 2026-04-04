        function resolveVmRootInstance() {
            if (!riveInstance) return null;
            if (riveInstance.viewModelInstance) return riveInstance.viewModelInstance;

            try {
                var defaultViewModel = typeof riveInstance.defaultViewModel === 'function'
                    ? riveInstance.defaultViewModel()
                    : null;
                if (!defaultViewModel) return null;
                if (typeof defaultViewModel.defaultInstance === 'function') {
                    return defaultViewModel.defaultInstance();
                }
                if (typeof defaultViewModel.instance === 'function') {
                    return defaultViewModel.instance();
                }
            } catch (e) {
                console.warn('Unable to resolve default ViewModel instance', e);
            }
            return null;
        }

        function safeVmCall(target, method, arg) {
            if (!target || typeof target[method] !== 'function') return null;
            try {
                return target[method](arg) || null;
            } catch (e) {
                return null;
            }
        }

        function getVmAccessor(vmInstance, propertyName) {
            var probes = [
                ['number', 'number'],
                ['boolean', 'boolean'],
                ['string', 'string'],
                ['enum', 'enum'],
                ['color', 'color'],
                ['trigger', 'trigger'],
            ];

            for (var i = 0; i < probes.length; i++) {
                var kind = probes[i][0];
                var methodName = probes[i][1];
                var accessor = safeVmCall(vmInstance, methodName, propertyName);
                if (accessor) {
                    return { kind: kind, accessor: accessor };
                }
            }
            return null;
        }

        function navigateToVmInstance(rootVm, path) {
            if (!path) return null;
            if (!path.includes('/')) {
                return { instance: rootVm, propertyName: path };
            }

            var segments = path.split('/');
            var propertyName = segments.pop();
            var current = rootVm;
            var i = 0;

            while (i < segments.length && current) {
                var segment = segments[i];

                // Try viewModel navigation
                var child = safeVmCall(current, 'viewModel', segment)
                    || safeVmCall(current, 'viewModelInstance', segment);

                if (child) {
                    current = child;
                    i++;
                    continue;
                }

                // Try list navigation
                if (i + 1 < segments.length) {
                    var listAccessor = safeVmCall(current, 'list', segment);
                    var numIndex = parseInt(segments[i + 1], 10);
                    if (listAccessor && !isNaN(numIndex)) {
                        var itemInstance = null;
                        try {
                            if (typeof listAccessor.instanceAt === 'function') {
                                itemInstance = listAccessor.instanceAt(numIndex);
                            }
                        } catch (e) { /* noop */ }
                        if (itemInstance) {
                            current = itemInstance;
                            i += 2;
                            continue;
                        }
                    }
                }

                console.warn('VM navigation failed at segment "' + segment + '" in path "' + path + '"');
                return null;
            }

            return current ? { instance: current, propertyName: propertyName } : null;
        }

        function resolveLiveAccessor(path, expectedKind) {
            var rootVm = resolveVmRootInstance();
            if (!rootVm) return null;

            var nav = navigateToVmInstance(rootVm, path);
            if (!nav) return null;

            var accessorInfo = getVmAccessor(nav.instance, nav.propertyName);
            if (!accessorInfo) return null;
            if (expectedKind && accessorInfo.kind !== expectedKind) return null;
            return accessorInfo.accessor;
        }

        function getStateMachineInputKind(input) {
            if (!input || typeof input !== 'object') return null;
            if (typeof input.fire === 'function') return 'trigger';
            if (typeof input.value === 'boolean') return 'boolean';
            if (typeof input.value === 'number') return 'number';
            return null;
        }

        function resolveStateMachineInputAccessor(stateMachineName, inputName, expectedKind) {
            if (!riveInstance || typeof riveInstance.stateMachineInputs !== 'function' || !stateMachineName || !inputName) {
                return null;
            }
            try {
                var inputs = riveInstance.stateMachineInputs(stateMachineName);
                if (!Array.isArray(inputs)) return null;
                var input = inputs.find(function (candidate) { return candidate && candidate.name === inputName; });
                if (!input) return null;
                var detectedKind = getStateMachineInputKind(input);
                if (expectedKind && detectedKind !== expectedKind) return null;
                return input;
            } catch (e) {
                return null;
            }
        }

        function resolveControlAccessor(descriptor) {
            if (descriptor && descriptor.source === 'state-machine') {
                return resolveStateMachineInputAccessor(descriptor.stateMachineName, descriptor.name, descriptor.kind);
            }
            return resolveLiveAccessor(descriptor.path, descriptor.kind);
        }

        function fireStateMachineTriggerByName(triggerName) {
            if (!riveInstance || typeof riveInstance.stateMachineInputs !== 'function' || !triggerName) return 0;

            var stateMachineNames = Array.isArray(riveInstance.stateMachineNames) ? riveInstance.stateMachineNames : [];
            var firedCount = 0;

            stateMachineNames.forEach(function (smName) {
                var inputs = [];
                try {
                    var resolved = riveInstance.stateMachineInputs(smName);
                    if (Array.isArray(resolved)) inputs = resolved;
                } catch (e) { inputs = []; }

                inputs.forEach(function (input) {
                    if (!input || input.name !== triggerName || typeof input.fire !== 'function') return;
                    try {
                        input.fire();
                        firedCount++;
                    } catch (e) { /* noop */ }
                });
            });

            return firedCount;
        }

        /* ── Dynamic VM hierarchy discovery (fallback) ───────── */

