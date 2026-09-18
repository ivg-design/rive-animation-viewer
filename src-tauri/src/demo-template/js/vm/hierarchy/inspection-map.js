        var inspectionVmIndex = null;

        function getInspectionVmIndex() {
            if (inspectionVmIndex !== null) return inspectionVmIndex;
            var map = CONFIG.inspectionMetadata && CONFIG.inspectionMetadata.viewModelMap;
            if (!map || !Array.isArray(map.prototypes) || !Array.isArray(map.roots)) {
                inspectionVmIndex = false;
                return inspectionVmIndex;
            }
            var prototypesById = new Map();
            var prototypesByName = new Map();
            map.prototypes.forEach(function (prototype) {
                if (!prototype || typeof prototype !== 'object') return;
                if (prototype.id) prototypesById.set(prototype.id, prototype);
                if (prototype.name) prototypesByName.set(prototype.name, prototype);
            });
            var instances = [];
            function collect(instance, rootKey) {
                if (!instance || typeof instance !== 'object') return;
                instances.push({ instance: instance, rootKey: rootKey });
                (instance.nestedInstances || []).forEach(function (relation) {
                    collect(relation && relation.instance, rootKey);
                });
            }
            map.roots.forEach(function (root) {
                collect(root && root.instance, root && root.key);
            });
            inspectionVmIndex = {
                instances: instances,
                prototypesById: prototypesById,
                prototypesByName: prototypesByName,
                roots: map.roots,
            };
            return inspectionVmIndex;
        }

        function mappedInstanceForLiveVm(index, liveVm, preferredName) {
            if (!index || !liveVm) return null;
            var instanceName = readVmStringMember(liveVm, 'instanceName')
                || readVmStringMember(liveVm, 'name');
            var viewModelName = readVmStringMember(liveVm, 'viewModelName');
            var exact = index.instances.find(function (entry) {
                return instanceName && entry.instance && entry.instance.name === instanceName;
            });
            if (exact) return exact.instance;
            var preferred = index.instances.find(function (entry) {
                return preferredName && entry.instance
                    && (entry.rootKey === preferredName || entry.instance.name === preferredName);
            });
            if (preferred) return preferred.instance;
            var byPrototype = index.instances.find(function (entry) {
                return viewModelName && entry.instance
                    && entry.instance.prototypeName === viewModelName;
            });
            if (byPrototype) return byPrototype.instance;
            var prototype = index.prototypesByName.get(viewModelName || preferredName);
            return prototype ? {
                id: '',
                name: instanceName || preferredName || '',
                prototypeId: prototype.id,
                prototypeName: prototype.name,
                nestedInstances: [],
                lists: [],
            } : null;
        }

        function buildVmHierarchyFromInspection(rootVm, globalViewModelName) {
            var index = getInspectionVmIndex();
            if (!index || !rootVm) return null;
            var mappedRoot = mappedInstanceForLiveVm(index, rootVm, globalViewModelName);
            if (!mappedRoot && index.roots.length === 1 && !globalViewModelName) {
                mappedRoot = index.roots[0] && index.roots[0].instance;
            }
            if (!mappedRoot) return null;

            var activeInstances = new WeakSet();
            var seenInputPaths = new Set();
            var totalInputs = 0;
            var expectedInputs = 0;
            var source = globalViewModelName ? 'global-view-model' : 'view-model';

            function prototypeFor(instance) {
                return index.prototypesById.get(instance && instance.prototypeId)
                    || index.prototypesByName.get(instance && instance.prototypeName)
                    || null;
            }

            function childMapForProperty(instance, property) {
                var relation = (instance && instance.nestedInstances || []).find(function (candidate) {
                    return candidate && candidate.propertyName === property.name;
                });
                if (relation && relation.instance) return relation.instance;
                var childPrototype = index.prototypesById.get(property.viewModelRef);
                return childPrototype ? {
                    id: '',
                    name: '',
                    prototypeId: childPrototype.id,
                    prototypeName: childPrototype.name,
                    nestedInstances: [],
                    lists: [],
                } : null;
            }

            function walk(liveInstance, mappedInstance, label, basePath, kind) {
                var node = {
                    label: label,
                    path: basePath || '<root>',
                    kind: kind || 'vm',
                    inputs: [],
                    children: [],
                    source: source,
                    globalViewModelName: globalViewModelName || null,
                };
                if (!liveInstance || typeof liveInstance !== 'object' || activeInstances.has(liveInstance)) return node;
                var prototype = prototypeFor(mappedInstance);
                if (!prototype || !Array.isArray(prototype.properties)) return node;
                activeInstances.add(liveInstance);

                prototype.properties.forEach(function (property) {
                    if (!property || typeof property.name !== 'string' || !property.name) return;
                    var name = property.name;
                    var fullPath = basePath ? basePath + '/' + name : name;
                    if (VM_CONTROL_KINDS.has(property.kind)) {
                        expectedInputs += 1;
                        var accessor = safeVmCall(liveInstance, property.kind, name);
                        if (accessor && !seenInputPaths.has(fullPath)) {
                            node.inputs.push({
                                name: name,
                                path: fullPath,
                                kind: property.kind,
                                source: source,
                                globalViewModelName: globalViewModelName || null,
                            });
                            seenInputPaths.add(fullPath);
                            totalInputs += 1;
                        }
                        return;
                    }
                    if (property.kind === 'viewmodel') {
                        var nestedVm = safeVmCall(liveInstance, 'viewModelInstance', name)
                            || safeVmCall(liveInstance, 'viewModel', name);
                        if (nestedVm && nestedVm !== liveInstance) {
                            node.children.push(walk(
                                nestedVm,
                                childMapForProperty(mappedInstance, property),
                                name,
                                fullPath,
                                'vm'
                            ));
                        }
                        return;
                    }
                    if (property.kind !== 'list') return;
                    var listAccessor = safeVmCall(liveInstance, 'list', name);
                    var listLength = 0;
                    if (listAccessor) {
                        if (typeof listAccessor.length === 'number') listLength = Math.max(0, Math.floor(listAccessor.length));
                        else if (typeof listAccessor.size === 'number') listLength = Math.max(0, Math.floor(listAccessor.size));
                    }
                    if (!listLength) return;
                    var listNode = {
                        label: name + ' [' + listLength + ']', path: fullPath, kind: 'list', inputs: [], children: [],
                        source: source, globalViewModelName: globalViewModelName || null,
                    };
                    for (var itemIndex = 0; itemIndex < listLength; itemIndex++) {
                        var item = null;
                        try { if (typeof listAccessor.instanceAt === 'function') item = listAccessor.instanceAt(itemIndex); } catch (e) { /* noop */ }
                        if (!item) continue;
                        var mappedItem = mappedInstanceForLiveVm(index, item, null);
                        if (!mappedItem) continue;
                        listNode.children.push(walk(
                            item,
                            mappedItem,
                            formatVmListItemLabel(name, itemIndex, item, riveInstance),
                            fullPath + '/' + itemIndex,
                            'instance'
                        ));
                    }
                    node.children.push(listNode);
                });

                activeInstances.delete(liveInstance);
                return node;
            }

            var label = globalViewModelName
                || readVmStringMember(rootVm, 'viewModelName')
                || readVmStringMember(rootVm, 'name')
                || 'Root VM';
            var rootNode = walk(rootVm, mappedRoot, label, '', globalViewModelName ? 'global-view-model' : 'vm');
            if (expectedInputs > 0 && totalInputs === 0) return null;
            rootNode.totalInputs = totalInputs;
            return rootNode;
        }
