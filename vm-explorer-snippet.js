// VM Explorer Snippet for Rive Animation Viewer
// Advanced ViewModelInstance exploration with path walking capabilities

const vmExplorerSnippet = `
onLoad: () => {
    riveInst.resizeDrawingSurfaceToCanvas();
    window.refreshVmInputControls && window.refreshVmInputControls();

		var rootVM = riveInst.viewModelInstance;
		if (!rootVM) {
			console.warn('No viewModelInstance bound on riveInst.');
			return;
		}

		// ------------- core: get/set via full paths on the ROOT instance -------------

		function getVmAccessorInfo(path) {
			if (!rootVM) {
				console.warn('No root ViewModelInstance.');
				return null;
			}
			var cleanPath = (path || '').trim();
			if (!cleanPath) {
				console.warn('Path is empty; must end with a property name.');
				return null;
			}

			// Let the runtime resolve the whole chain from the root instance.
			var numberAcc = rootVM.number && rootVM.number(cleanPath);
			var boolAcc = !numberAcc && rootVM.boolean && rootVM.boolean(cleanPath);
			var stringAcc = !numberAcc && !boolAcc && rootVM.string && rootVM.string(cleanPath);
			var enumAcc = !numberAcc && !boolAcc && !stringAcc && rootVM.enum && rootVM.enum(cleanPath);
			var colorAcc = !numberAcc && !boolAcc && !stringAcc && !enumAcc && rootVM.color && rootVM.color(cleanPath);
			var triggerAcc = !numberAcc && !boolAcc && !stringAcc && !enumAcc && !colorAcc && rootVM.trigger && rootVM.trigger(cleanPath);

			var acc = numberAcc || boolAcc || stringAcc || enumAcc || colorAcc || triggerAcc;
			if (!acc) {
				console.warn('No accessor found for path:', cleanPath);
				return null;
			}
			return {
				path: cleanPath,
				kind: numberAcc ? 'number' : boolAcc ? 'boolean' : stringAcc ? 'string' : enumAcc ? 'enum' : colorAcc ? 'color' : 'trigger',
				accessor: acc,
			};
		}

		function getVmAccessor(path) {
			var info = getVmAccessorInfo(path);
			return info ? info.accessor : null;
		}

		function getVmValue(path) {
			var info = getVmAccessorInfo(path);
			if (!info) return undefined;
			if (info.kind === 'trigger') return '(trigger)';
			return info.accessor ? info.accessor.value : undefined;
		}

		function setVmValue(path, newValue) {
			var info = getVmAccessorInfo(path);
			if (!info || !info.accessor) return undefined;
			if (info.kind === 'trigger') {
				if (info.accessor.trigger) info.accessor.trigger();
				return true;
			}
			info.accessor.value = newValue;
			return info.accessor.value;
		}

		function fireVmTrigger(path) {
			var info = getVmAccessorInfo(path);
			if (!info || info.kind !== 'trigger' || !info.accessor) {
				console.warn('No trigger accessor found at path:', path);
				return false;
			}
			if (info.accessor.trigger) info.accessor.trigger();
			return true;
		}

		// ------------- tree builder: discover structure + paths ----------------------

		// Node shape: { path, scalars: [...], children: { segment: node } }
		var vmTree = { path: '<root>', scalars: [], children: {} };
		var scalarPaths = [];
		var vmInputs = [];
		var activeInstances = new WeakSet();

		function ensureChildNode(parentNode, segPath, segKey) {
			if (!parentNode.children[segKey]) {
				parentNode.children[segKey] = {
					path: segPath,
					scalars: [],
					children: {},
				};
			}
			return parentNode.children[segKey];
		}

		function addVmInput(path, kind) {
			for (var i = 0; i < vmInputs.length; i++) {
				if (vmInputs[i].path === path) return;
			}
			vmInputs.push({ path: path, kind: kind });
		}

		function buildTree(instance, basePath, parentNode) {
			if (!instance || !instance.properties) return;
			if (activeInstances.has(instance)) return;
			activeInstances.add(instance);

			var props = instance.properties;
			for (var i = 0; i < props.length; i++) {
				var prop = props[i];
				var name = prop.name;
				var fullPath = basePath ? basePath + '/' + name : name;

				// Node for this property level
				var childNode = ensureChildNode(parentNode, fullPath, name);

				// Scalar/writable input? Ask the ROOT instance by full path.
				var accessorInfo = getVmAccessorInfo(fullPath);
				if (accessorInfo) {
					var kind = accessorInfo.kind;
					var value = kind === 'trigger' ? '(trigger)' : accessorInfo.accessor ? accessorInfo.accessor.value : null;

					childNode.scalars.push({
						name: name,
						path: fullPath,
						kind: kind,
						value: value,
					});
					scalarPaths.push(fullPath);
					addVmInput(fullPath, kind);
				}

				// Nested view model instance under this property?
				var nestedInst = (instance.viewModelInstance && instance.viewModelInstance(name)) || (instance.viewModel && instance.viewModel(name));

				if (nestedInst && nestedInst !== instance) {
					buildTree(nestedInst, fullPath, childNode);
				}

				// List? We will treat list items as children "0", "1", etc.
				var list = instance.list && instance.list(name);
				var listLength = list && typeof list.length === 'number' ? list.length : list && typeof list.size === 'number' ? list.size : 0;
				if (list && listLength > 0) {
					for (var idx = 0; idx < listLength; idx++) {
						var instAt = list.instanceAt && list.instanceAt(idx);
						if (!instAt) continue;
						var idxSeg = String(idx);
						var itemPath = fullPath + '/' + idxSeg;
						var listNode = ensureChildNode(childNode, itemPath, idxSeg);
						buildTree(instAt, itemPath, listNode);
					}
				}
			}
			activeInstances.delete(instance);
		}

		// Build once on load
		buildTree(rootVM, '', vmTree);

		// Simple status message
		console.log('VM Explorer loaded. Found', scalarPaths.length, 'scalar properties.');

		// ------------- explorer: show a table at a given prefix ----------------------

		function exploreVmLevel(pathPrefix) {
			var clean = (pathPrefix || '').trim();

			// Walk vmTree by segments to find the node for this prefix (if any)
			var node = vmTree;
			var currentInstance = rootVM;
			if (clean !== '' && clean !== '<root>') {
				var segs = clean.split('/');
				for (var i = 0; i < segs.length; i++) {
					var seg = segs[i].trim();
					if (!seg) continue;
					if (!node.children[seg]) {
						console.warn('No tree node for prefix:', clean);
						return null;
					}
					node = node.children[seg];

					// Try to get the actual instance at this path
					if (currentInstance.viewModelInstance && currentInstance.viewModelInstance(seg)) {
						currentInstance = currentInstance.viewModelInstance(seg);
					} else if (currentInstance.viewModel && currentInstance.viewModel(seg)) {
						currentInstance = currentInstance.viewModel(seg);
					}
				}
			}

			var rows = [];

			// Scalars directly at this level
			for (var s = 0; s < node.scalars.length; s++) {
				var sc = node.scalars[s];
				var scalarValue;

				// Try to get value from current instance directly first
				if (sc.kind === 'number' && currentInstance.number) {
					var numAcc = currentInstance.number(sc.name);
					scalarValue = numAcc ? numAcc.value : getVmValue(sc.path);
				} else if (sc.kind === 'boolean' && currentInstance.boolean) {
					var boolAcc = currentInstance.boolean(sc.name);
					scalarValue = boolAcc ? boolAcc.value : getVmValue(sc.path);
				} else if (sc.kind === 'string' && currentInstance.string) {
					var strAcc = currentInstance.string(sc.name);
					scalarValue = strAcc ? strAcc.value : getVmValue(sc.path);
				} else if (sc.kind === 'enum' && currentInstance.enum) {
					var enumAcc = currentInstance.enum(sc.name);
					scalarValue = enumAcc ? enumAcc.value : getVmValue(sc.path);
				} else if (sc.kind === 'color' && currentInstance.color) {
					var colorAcc = currentInstance.color(sc.name);
					scalarValue = colorAcc ? colorAcc.value : getVmValue(sc.path);
				} else if (sc.kind === 'trigger') {
					scalarValue = '(trigger)';
				} else {
					scalarValue = getVmValue(sc.path);
				}

				rows.push({
					name: sc.name,
					path: sc.path,
					type: sc.kind,
					value: scalarValue,
				});
			}

			// Child nodes (nested VMs or list items)
			for (var key in node.children) {
				if (!Object.prototype.hasOwnProperty.call(node.children, key)) continue;
				var child = node.children[key];
				var childCount = child.children ? Object.keys(child.children).length : 0;

				// Determine the actual type of this child
				var childType = 'unknown';
				var childValue = undefined;

				// Check if it's a scalar type (might not have been caught during tree building)
				var numAcc = currentInstance.number && currentInstance.number(key);
				var boolAcc = !numAcc && currentInstance.boolean && currentInstance.boolean(key);
				var strAcc = !numAcc && !boolAcc && currentInstance.string && currentInstance.string(key);
				var enumAcc = !numAcc && !boolAcc && !strAcc && currentInstance.enum && currentInstance.enum(key);

				if (numAcc) {
					childType = 'number';
					childValue = numAcc.value;
				} else if (boolAcc) {
					childType = 'boolean';
					childValue = boolAcc.value;
				} else if (strAcc) {
					childType = 'string';
					childValue = strAcc.value;
				} else if (enumAcc) {
					childType = 'enum';
					childValue = enumAcc.value;
				}

				// Check if it's a Trigger
				var triggerInst = currentInstance.trigger && currentInstance.trigger(key);
				if (triggerInst) {
					childType = 'trigger';
					childValue = '(event)';
				}

				// Check if it's a Color
				var colorInst = currentInstance.color && currentInstance.color(key);
				if (colorInst) {
					childType = 'color';
					childValue = colorInst.value;
				}

				// Check if it's a ViewModelInstance
				var vmInst = (currentInstance.viewModelInstance && currentInstance.viewModelInstance(key)) ||
				             (currentInstance.viewModel && currentInstance.viewModel(key));
				if (vmInst) {
					childType = 'viewmodel';
					// Show property count for viewmodels
					var propCount = vmInst.properties ? vmInst.properties.length : 0;
					childValue = propCount + ' properties';
				}

				// Check if it's a List
				var listInst = currentInstance.list && currentInstance.list(key);
				if (listInst) {
					childType = 'list';
					childValue = 'length: ' + (listInst.length || 0);
				}

				rows.push({
					name: key,
					path: child.path,
					type: childType,
					value: childValue,
					children: childCount,
				});
			}

			console.group('VM explore @ ' + (clean || '<root>'));
			console.table(rows);
			console.groupEnd();

			return {
				prefix: clean || '<root>',
				node: node,
				rows: rows,
			};
		}

		// ------------- expose tools on window ---------------------------------------

		window.vmRootInstance = rootVM;
		window.vmTree = vmTree;
		window.vmPaths = scalarPaths;
		window.vmInputs = vmInputs;

		window.vmAccessor = function (path) {
			return getVmAccessor(path);
		};
		window.vmGet = function (path) {
			return getVmValue(path);
		};
		window.vmSet = function (path, value) {
			return setVmValue(path, value);
		};
		window.vmFire = function (path) {
			return fireVmTrigger(path);
		};
		window.vmExplore = function (prefix) {
			return exploreVmLevel(prefix || '');
		};
	},
`;

// Export for use in app.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = vmExplorerSnippet;
}
