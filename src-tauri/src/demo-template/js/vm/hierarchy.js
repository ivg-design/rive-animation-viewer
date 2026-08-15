        function normalizeControlDescriptor(input) {
            var source = input && input.descriptor ? input.descriptor : input;
            if (!source || typeof source !== 'object') return null;
            return {
                kind: source.kind || null,
                name: source.name || null,
                path: source.path || null,
                source: source.source || 'view-model',
                stateMachineName: source.stateMachineName || null,
            };
        }

        function isControlDescriptorAllowed(descriptor) {
            if (!descriptor) return false;
            var exactKey = controlSnapshotKeyForDescriptor(descriptor);
            if (exactKey && ALLOWED_CONTROL_KEYS.has(exactKey)) return true;
            var selectionKey = controlSelectionKeyForDescriptor(descriptor);
            return Boolean(selectionKey) && ALLOWED_CONTROL_KEYS.has(selectionKey);
        }

        function filterHierarchyNode(node) {
            if (!node || typeof node !== 'object') return null;
            var inputs = (node.inputs || []).filter(function (input) {
                return isControlDescriptorAllowed(normalizeControlDescriptor(input));
            });
            var children = (node.children || [])
                .map(function (child) { return filterHierarchyNode(child); })
                .filter(Boolean);
            if (!inputs.length && !children.length) return null;

            var filtered = Object.assign({}, node, { children: children, inputs: inputs });
            filtered.totalInputs = countHierarchyInputs(filtered);
            return filtered;
        }

        function getVmListItemName(itemInstance) {
            if (!itemInstance || typeof itemInstance !== 'object') return null;
            var names = ['name', 'viewModelName', 'instanceName'];
            for (var nameIndex = 0; nameIndex < names.length; nameIndex++) {
                var value = null;
                try {
                    value = itemInstance[names[nameIndex]];
                    if (typeof value === 'function') value = value.call(itemInstance);
                } catch (e) { value = null; }
                if (typeof value === 'string' && value.trim()) return value.trim();
            }
            return null;
        }

        function formatVmListItemLabel(listName, index, itemInstance) {
            var authoredName = getVmListItemName(itemInstance);
            if (authoredName) return authoredName;
            var words = String(listName || 'Item')
                .trim()
                .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
                .replace(/[_-]+/g, ' ')
                .split(/\s+/)
                .filter(Boolean);
            var lastIndex = words.length - 1;
            if (lastIndex >= 0) {
                var word = words[lastIndex];
                if (/ies$/i.test(word) && word.length > 3) words[lastIndex] = word.slice(0, -3) + 'y';
                else if (/(ches|shes|xes|zes)$/i.test(word)) words[lastIndex] = word.slice(0, -2);
                else if (/s$/i.test(word) && !/ss$/i.test(word)) words[lastIndex] = word.slice(0, -1);
            }
            var label = words
                .map(function (word) { return word.charAt(0).toUpperCase() + word.slice(1); })
                .join(' ') || 'Item';
            return label + ' ' + (index + 1);
        }

        function buildVmListTopologySignature(rootVm) {
            if (!rootVm || typeof rootVm !== 'object') return null;

            var activeInstances = new WeakSet();
            var topology = [];

            function walk(instance, basePath) {
                if (!instance || typeof instance !== 'object' || activeInstances.has(instance)) return;
                activeInstances.add(instance);

                var properties = Array.isArray(instance.properties) ? instance.properties : [];
                properties.forEach(function (property) {
                    var name = property && property.name;
                    if (typeof name !== 'string' || !name) return;

                    var fullPath = basePath ? basePath + '/' + name : name;
                    var nestedVm = safeVmCall(instance, 'viewModelInstance', name)
                        || safeVmCall(instance, 'viewModel', name);
                    if (nestedVm && nestedVm !== instance) walk(nestedVm, fullPath);

                    var listAccessor = safeVmCall(instance, 'list', name);
                    if (!listAccessor) return;
                    var listLength = 0;
                    if (typeof listAccessor.length === 'number') listLength = Math.max(0, Math.floor(listAccessor.length));
                    else if (typeof listAccessor.size === 'number') listLength = Math.max(0, Math.floor(listAccessor.size));
                    topology.push(['list', fullPath, listLength]);

                    for (var index = 0; index < listLength; index++) {
                        var itemInstance = null;
                        try { if (typeof listAccessor.instanceAt === 'function') itemInstance = listAccessor.instanceAt(index); } catch (e) { /* noop */ }
                        var itemPath = fullPath + '/' + index;
                        topology.push(['item', itemPath, Boolean(itemInstance)]);
                        if (itemInstance) walk(itemInstance, itemPath);
                    }
                });

                activeInstances.delete(instance);
            }

            walk(rootVm, '');
            return topology.length ? JSON.stringify(topology) : null;
        }

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
                        && !seenInputPaths.has(fullPath)) {
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
                                listNode.children.push(walk(itemInstance, formatVmListItemLabel(name, idx, itemInstance), fullPath + '/' + idx, 'instance'));
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
