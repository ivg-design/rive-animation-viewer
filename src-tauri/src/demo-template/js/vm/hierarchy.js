        function buildVmHierarchy(rootVm) {
            var seenInputPaths = new Set();
            var activeInstances = new WeakSet();
            var totalInputs = 0;

            function walk(instance, label, basePath, kind) {
                var node = {
                    label: label,
                    path: basePath || '<root>',
                    kind: kind || 'vm',
                    inputs: [],
                    children: [],
                };
                if (!instance || typeof instance !== 'object') return node;
                if (activeInstances.has(instance)) return node;
                activeInstances.add(instance);

                var properties = Array.isArray(instance.properties) ? instance.properties : [];
                properties.forEach(function (property) {
                    var name = property && property.name;
                    if (typeof name !== 'string' || !name) return;

                    var fullPath = basePath ? basePath + '/' + name : name;
                    var accessorInfo = getVmAccessor(instance, name);
                    if (accessorInfo
                        && VM_CONTROL_KINDS.has(accessorInfo.kind)
                        && !seenInputPaths.has(fullPath)
                        && isControlDescriptorAllowed({ kind: accessorInfo.kind, name: name, path: fullPath, source: 'view-model' })) {
                        node.inputs.push({ name: name, path: fullPath, kind: accessorInfo.kind });
                        seenInputPaths.add(fullPath);
                        totalInputs += 1;
                    }

                    var nestedVm = safeVmCall(instance, 'viewModelInstance', name)
                        || safeVmCall(instance, 'viewModel', name);
                    if (nestedVm && nestedVm !== instance) {
                        node.children.push(walk(nestedVm, name, fullPath, 'vm'));
                    }

                    var listAccessor = safeVmCall(instance, 'list', name);
                    var listLength = 0;
                    if (listAccessor) {
                        if (typeof listAccessor.length === 'number') listLength = Math.max(0, Math.floor(listAccessor.length));
                        else if (typeof listAccessor.size === 'number') listLength = Math.max(0, Math.floor(listAccessor.size));
                    }
                    if (listLength > 0) {
                        var listNode = { label: name + ' [' + listLength + ']', path: fullPath, kind: 'list', inputs: [], children: [] };
                        for (var idx = 0; idx < listLength; idx++) {
                            var itemInstance = null;
                            try { if (typeof listAccessor.instanceAt === 'function') itemInstance = listAccessor.instanceAt(idx); } catch (e) { /* noop */ }
                            if (itemInstance) {
                                listNode.children.push(walk(itemInstance, 'Instance ' + idx, fullPath + '/' + idx, 'instance'));
                            }
                        }
                        node.children.push(listNode);
                    }
                });

                activeInstances.delete(instance);
                return node;
            }

            var rootNode = walk(rootVm, 'Root VM', '', 'vm');
            rootNode.totalInputs = totalInputs;
            return rootNode;
        }

        function buildStateMachineHierarchy() {
            if (!riveInstance || typeof riveInstance.stateMachineInputs !== 'function') return null;

            var stateMachineNames = Array.isArray(riveInstance.stateMachineNames) ? riveInstance.stateMachineNames : [];
            if (!stateMachineNames.length) return null;

            var rootNode = {
                label: 'State Machines',
                path: '__state_machines__',
                kind: 'state-machines',
                inputs: [],
                children: [],
                totalInputs: 0,
            };

            stateMachineNames.forEach(function (stateMachineName) {
                var inputs = [];
                try {
                    var resolved = riveInstance.stateMachineInputs(stateMachineName);
                    if (Array.isArray(resolved)) inputs = resolved;
                } catch (e) { inputs = []; }

                var childNode = {
                    label: stateMachineName,
                    path: 'stateMachine/' + stateMachineName,
                    kind: 'state-machine',
                    inputs: [],
                    children: [],
                };

                inputs.forEach(function (input) {
                    var inputKind = getStateMachineInputKind(input);
                    var inputName = input && typeof input.name === 'string' && input.name ? input.name : null;
                    if (!inputKind || !inputName) return;

                    var descriptor = {
                        kind: inputKind,
                        name: inputName,
                        path: 'stateMachine/' + stateMachineName + '/' + inputName,
                        source: 'state-machine',
                        stateMachineName: stateMachineName,
                    };
                    if (!isControlDescriptorAllowed(descriptor)) return;

                    childNode.inputs.push({
                        name: inputName,
                        path: descriptor.path,
                        kind: inputKind,
                        source: 'state-machine',
                        stateMachineName: stateMachineName,
                    });
                    rootNode.totalInputs += 1;
                });

                if (childNode.inputs.length) {
                    rootNode.children.push(childNode);
                }
            });

            return rootNode.totalInputs > 0 ? rootNode : null;
        }

        /* ── VM controls rendering ───────────────────────────── */
