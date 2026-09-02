        function normalizeControlDescriptor(input) {
            var source = input && input.descriptor ? input.descriptor : input;
            if (!source || typeof source !== 'object') return null;
            return {
                kind: source.kind || null,
                name: source.name || null,
                path: source.path || null,
                source: source.source || 'view-model',
                globalViewModelName: source.globalViewModelName || null,
                stateMachineName: source.stateMachineName || null,
            };
        }

        function isControlDescriptorAllowed(descriptor) {
            if (!descriptor) return false;
            if (typeof isRenderSurfaceMode !== 'undefined' && isRenderSurfaceMode && CONTROL_SELECTION_KEYS === null) return true;
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

        function readVmStringMember(target, propertyName) {
            if (!target || typeof target !== 'object') return null;
            var value = null;
            try {
                value = target[propertyName];
                if (typeof value === 'function') value = value.call(target);
            } catch (e) { value = null; }
            return typeof value === 'string' && value.trim() ? value.trim() : null;
        }

        function getCanonicalVmInstanceNames(instance, viewModelName) {
            var definition = safeVmCall(instance, 'viewModelByName', viewModelName);
            if (!definition) return new Set();

            var instanceNames = null;
            try {
                instanceNames = definition.instanceNames;
                if (typeof instanceNames === 'function') instanceNames = instanceNames.call(definition);
            } catch (e) { instanceNames = null; }
            if (!Array.isArray(instanceNames)) return new Set();

            return new Set(instanceNames
                .filter(function (name) { return typeof name === 'string' && name.trim(); })
                .map(function (name) { return name.trim(); }));
        }

        function findCanonicalVmInstanceName(itemInstance, instance) {
            var viewModelName = readVmStringMember(itemInstance, 'viewModelName');
            if (!viewModelName) return null;

            var canonicalNames = getCanonicalVmInstanceNames(instance, viewModelName);
            if (!canonicalNames.size) return null;

            var properties = [];
            try { properties = Array.isArray(itemInstance.properties) ? itemInstance.properties : []; } catch (e) { properties = []; }
            var matches = new Set();
            properties.forEach(function (property) {
                var propertyName = property && typeof property.name === 'string' ? property.name : null;
                if (!propertyName) return;
                var accessor = safeVmCall(itemInstance, 'string', propertyName);
                var value = readVmStringMember(accessor, 'value');
                if (value && canonicalNames.has(value)) matches.add(value);
            });

            return matches.size === 1 ? Array.from(matches)[0] : null;
        }

        function getVmListItemName(itemInstance, instance) {
            if (!itemInstance || typeof itemInstance !== 'object') return null;
            var names = ['instanceName', 'name'];
            for (var nameIndex = 0; nameIndex < names.length; nameIndex++) {
                var value = readVmStringMember(itemInstance, names[nameIndex]);
                if (value) return value;
            }
            return findCanonicalVmInstanceName(itemInstance, instance);
        }

        function formatVmListItemLabel(listName, index, itemInstance) {
            var instance = arguments.length > 3 ? arguments[3] : riveInstance;
            var authoredName = getVmListItemName(itemInstance, instance);
            if (authoredName) return authoredName;
            return 'Row ' + (index + 1);
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
                        topology.push([
                            'item',
                            itemPath,
                            Boolean(itemInstance),
                            itemInstance ? formatVmListItemLabel(name, index, itemInstance, riveInstance) : null,
                        ]);
                        if (itemInstance) walk(itemInstance, itemPath);
                    }
                });

                activeInstances.delete(instance);
            }

            walk(rootVm, '');
            return topology.length ? JSON.stringify(topology) : null;
        }

        function getGlobalViewModelNames() {
            var names = safeVmCall(riveInstance, 'globalViewModelNames');
            return Array.isArray(names)
                ? names.filter(function (name) { return typeof name === 'string' && name.trim(); })
                : [];
        }

        function buildAllVmTopologySignature() {
            var mainTopology = buildVmListTopologySignature(resolveVmRootInstance());
            var globalTopologies = getGlobalViewModelNames().sort().map(function (name) {
                return [name, buildVmListTopologySignature(resolveGlobalVmRootInstance(name))];
            });
            if (!mainTopology && !globalTopologies.length) return null;
            return JSON.stringify({ globals: globalTopologies, root: mainTopology });
        }

        function buildVmHierarchy(rootVm, globalViewModelName) {
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
                    source: globalViewModelName ? 'global-view-model' : 'view-model',
                    globalViewModelName: globalViewModelName || null,
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
                        node.inputs.push({
                            name: name,
                            path: fullPath,
                            kind: accessorInfo.kind,
                            source: globalViewModelName ? 'global-view-model' : 'view-model',
                            globalViewModelName: globalViewModelName || null,
                        });
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
                        var listNode = {
                            label: name + ' [' + listLength + ']', path: fullPath, kind: 'list', inputs: [], children: [],
                            source: globalViewModelName ? 'global-view-model' : 'view-model',
                            globalViewModelName: globalViewModelName || null,
                        };
                        for (var idx = 0; idx < listLength; idx++) {
                            var itemInstance = null;
                            try { if (typeof listAccessor.instanceAt === 'function') itemInstance = listAccessor.instanceAt(idx); } catch (e) { /* noop */ }
                            if (itemInstance) {
                                listNode.children.push(walk(itemInstance, formatVmListItemLabel(name, idx, itemInstance, riveInstance), fullPath + '/' + idx, 'instance'));
                            }
                        }
                        node.children.push(listNode);
                    }
                });

                activeInstances.delete(instance);
                return node;
            }

            var rootNode = walk(rootVm, globalViewModelName || 'Root VM', '', globalViewModelName ? 'global-view-model' : 'vm');
            rootNode.totalInputs = totalInputs;
            return rootNode;
        }

        function buildStateMachineHierarchy() {
            if (!riveInstance) return null;

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
                var inputs = runtimeCompatibility.getStateMachineInputMetadata(riveInstance, stateMachineName);
                // `contents` knows the selected artboard's authored inputs. An
                // exact empty list is conclusive and avoids the deprecated
                // runtime probe; unknown metadata retains legacy support.
                if (!Array.isArray(inputs)) {
                    inputs = [];
                    try {
                        var resolved = riveInstance.stateMachineInputs && riveInstance.stateMachineInputs(stateMachineName);
                        if (Array.isArray(resolved)) inputs = resolved;
                    } catch (e) { inputs = []; }
                }

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
