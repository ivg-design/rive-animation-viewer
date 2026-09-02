        // Keep reset semantics deterministic across UI, MCP and the visible
        // renderer. `null` is auto-bound; zero is a valid runtime-list key.
        function normalizeRenderSurfaceVmInstanceKey(instanceKey) {
            if (instanceKey === '__rav_auto_bound__' || instanceKey === null || typeof instanceKey === 'undefined') {
                return null;
            }
            if (typeof instanceKey === 'string' && !instanceKey.trim()) {
                return null;
            }
            return instanceKey;
        }

        function normalizeRenderSurfacePlaybackNames(value) {
            var names = Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []);
            return names.filter(function (name, index) {
                return typeof name === 'string' && name && names.indexOf(name) === index;
            });
        }

        // Web runtime reset rebuilds animatables with their `playing` flags,
        // but affected 2.39/2.40 builds do not restart the RAF loop that
        // cleanupInstances stopped. Resume that loop after all child-owned
        // state is restored without replacing the Rive/canvas surface. Keep a
        // targeted play fallback for runtime builds without startRendering().
        function restartRenderSurfacePlaybackAfterReset(instance, resetParams) {
            var params = resetParams && typeof resetParams === 'object' ? resetParams : {};
            if (params.autoplay === false) return { names: [], restarted: false };
            if (!instance) throw new Error('Playback restart is unavailable after reset.');
            var names = normalizeRenderSurfacePlaybackNames(params.animations)
                .concat(runtimeCompatibility.getStateMachineNames(params))
                .filter(function (name, index, allNames) { return allNames.indexOf(name) === index; });
            if (typeof instance.startRendering === 'function') {
                instance.startRendering();
                return { names: names, restarted: true };
            }
            if (typeof instance.play !== 'function') {
                throw new Error('Playback restart is unavailable after reset.');
            }
            if (names.length === 1) instance.play(names[0]);
            else if (names.length > 1) instance.play(names);
            else instance.play();
            return { names: names, restarted: true };
        }

        function buildRenderSurfaceResetContract(rawParams) {
            var params = rawParams && typeof rawParams === 'object' ? rawParams : {};
            var vmInstanceKey = normalizeRenderSurfaceVmInstanceKey(params.viewModelInstanceName);
            var normalizedParams = runtimeCompatibility.normalizePlaybackConfig(Object.assign({}, params, {
                autoBind: vmInstanceKey === null,
                autoplay: params.autoplay !== false,
                viewModelInstanceName: vmInstanceKey,
            }), CONFIG.runtimeVersion);
            var stateMachineNames = runtimeCompatibility.getStateMachineNames(normalizedParams);
            var animationNames = normalizeRenderSurfacePlaybackNames(normalizedParams.animations);
            return {
                params: normalizedParams,
                target: {
                    name: animationNames[0] || stateMachineNames[0] || null,
                    type: animationNames.length ? 'animation' : (stateMachineNames.length ? 'stateMachine' : null),
                    vmInstanceKey: vmInstanceKey,
                },
            };
        }
