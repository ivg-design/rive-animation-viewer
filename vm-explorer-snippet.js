// VM Explorer Snippet for Rive Animation Viewer
// Advanced ViewModelInstance exploration with path walking capabilities

const vmExplorerSnippet = `
onLoad: () => {
    riveInst.resizeDrawingSurfaceToCanvas();

		var rootVM = riveInst.viewModelInstance;
		if (!rootVM) {
			console.warn('No viewModelInstance bound on riveInst.');
			return;
		}

		// ------------- core: get/set via full paths on the ROOT instance -------------

		function getVmAccessor(path) {
			if (!rootVM) {
				console.warn('No root ViewModelInstance.');
				return null;
			}
			var cleanPath = (path || '').trim();
			if (!cleanPath) {
				console.warn('Path is empty; must end with a property name.');
				return null;
			}

			// Let the runtime resolve the whole chain: this is what you were saying.
			var acc = (rootVM.number && rootVM.number(cleanPath)) || (rootVM.boolean && rootVM.boolean(cleanPath)) || (rootVM.string && rootVM.string(cleanPath)) || (rootVM.enum && rootVM.enum(cleanPath));

			if (!acc) {
				console.warn('No accessor found for path:', cleanPath);
			}
			return acc;
		}

		function getVmValue(path) {
			var acc = getVmAccessor(path);
			return acc ? acc.value : undefined;
		}

		function setVmValue(path, newValue) {
			var acc = getVmAccessor(path);
			if (!acc) return undefined;
			acc.value = newValue;
			return acc.value;
		}

		// ------------- tree builder: discover structure + paths ----------------------

		// Node shape: { path, scalars: [...], children: { segment: node } }
		var vmTree = { path: '<root>', scalars: [], children: {} };
		var scalarPaths = [];

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

		function buildTree(instance, basePath, parentNode) {
			if (!instance || !instance.properties) return;

			var props = instance.properties;
			for (var i = 0; i < props.length; i++) {
				var prop = props[i];
				var name = prop.name;
				var fullPath = basePath ? basePath + '/' + name : name;

				// Node for this property level
				var childNode = ensureChildNode(parentNode, fullPath, name);

				// Scalar? Ask the ROOT instance by full path (this is key).
				var accNumber = rootVM.number && rootVM.number(fullPath);
				var accBool = !accNumber && rootVM.boolean && rootVM.boolean(fullPath);
				var accString = !accNumber && !accBool && rootVM.string && rootVM.string(fullPath);
				var accEnum = !accNumber && !accBool && !accString && rootVM.enum && rootVM.enum(fullPath);

				if (accNumber || accBool || accString || accEnum) {
					var kind = accNumber ? 'number' : accBool ? 'boolean' : accString ? 'string' : 'enum';
					var value = accNumber || accBool || accString || accEnum ? (accNumber || accBool || accString || accEnum).value : null;

					childNode.scalars.push({
						name: name,
						path: fullPath,
						kind: kind,
						value: value,
					});
					scalarPaths.push(fullPath);
				}

				// Nested view model instance under this property?
				var nestedInst = (instance.viewModelInstance && instance.viewModelInstance(name)) || (instance.viewModel && instance.viewModel(name));

				if (nestedInst && nestedInst !== instance) {
					buildTree(nestedInst, fullPath, childNode);
				}

				// List? We will treat list items as children "0", "1", etc.
				var list = instance.list && instance.list(name);
				if (list && typeof list.length === 'number') {
					for (var idx = 0; idx < list.length; idx++) {
						var instAt = list.instanceAt && list.instanceAt(idx);
						if (!instAt) continue;
						var idxSeg = String(idx);
						var itemPath = fullPath + '/' + idxSeg;
						var listNode = ensureChildNode(childNode, itemPath, idxSeg);
						buildTree(instAt, itemPath, listNode);
					}
				}
			}
		}

		// Build once on load
		buildTree(rootVM, '', vmTree);

		// Display comprehensive usage guide
		console.log('%cRive VM Explorer Loaded Successfully', 'color: #4CAF50; font-size: 16px; font-weight: bold');
		console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #666');
		console.log('%cAvailable Commands:', 'color: #2196F3; font-weight: bold');
		console.log('  %cvmExplore()%c or %cvmExplore("path")%c', 'color: #4CAF50; font-family: monospace', 'color: #888', 'color: #4CAF50; font-family: monospace', 'color: #888');
		console.log('    → Show interactive table of properties at root or specified path');
		console.log('    → Example: vmExplore("myGroup/subItem")');
		console.log('  %cvmGet("path")%c', 'color: #4CAF50; font-family: monospace', 'color: #888');
		console.log('    → Get current value at path');
		console.log('    → Example: vmGet("settings/volume")');
		console.log('  %cvmSet("path", value)%c', 'color: #4CAF50; font-family: monospace', 'color: #888');
		console.log('    → Update value at path');
		console.log('    → Example: vmSet("settings/volume", 0.8)');
		console.log('');
		console.log('%cAvailable Data Structures:', 'color: #FF9800; font-weight: bold');
		console.log('  %cvmTree%c         - Full hierarchical structure of all ViewModels', 'color: #4CAF50; font-family: monospace', 'color: #888');
		console.log('  %cvmPaths%c        - Array of all scalar property paths (ready for get/set)', 'color: #4CAF50; font-family: monospace', 'color: #888');
		console.log('  %cvmRootInstance%c - The root ViewModelInstance object', 'color: #4CAF50; font-family: monospace', 'color: #888');
		console.log('');
		console.log('%cQuick Start:', 'color: #9C27B0; font-weight: bold');
		console.log('  1. Run %cvmExplore()%c to see all available properties', 'color: #4CAF50; font-family: monospace', 'color: #888');
		console.log('  2. Navigate deeper with %cvmExplore("path/to/item")%c', 'color: #4CAF50; font-family: monospace', 'color: #888');
		console.log('  3. Read values with %cvmGet("path")%c', 'color: #4CAF50; font-family: monospace', 'color: #888');
		console.log('  4. Modify values with %cvmSet("path", newValue)%c', 'color: #4CAF50; font-family: monospace', 'color: #888');
		console.log('');
		console.log('%c━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'color: #666');
		console.log('Found %c' + scalarPaths.length + '%c scalar properties in the VM tree', 'color: #4CAF50; font-weight: bold', 'color: #888');

		// ------------- explorer: show a table at a given prefix ----------------------

		function exploreVmLevel(pathPrefix) {
			var clean = (pathPrefix || '').trim();

			// Walk vmTree by segments to find the node for this prefix (if any)
			var node = vmTree;
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
				}
			}

			var rows = [];

			// Scalars directly at this level
			for (var s = 0; s < node.scalars.length; s++) {
				var sc = node.scalars[s];
				rows.push({
					kind: 'scalar',
					name: sc.name,
					path: sc.path,
					type: sc.kind,
					value: getVmValue(sc.path),
				});
			}

			// Child nodes (nested VMs or list items)
			for (var key in node.children) {
				if (!Object.prototype.hasOwnProperty.call(node.children, key)) continue;
				var child = node.children[key];

				// Heuristic: if child has scalars or children, treat it as a nested group
				var hasScalars = child.scalars && child.scalars.length > 0;
				var childCount = child.children ? Object.keys(child.children).length : 0;

				rows.push({
					kind: 'group',
					name: key,
					path: child.path,
					type: 'group',
					children: childCount,
					hasScalars: hasScalars,
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

		window.vmAccessor = function (path) {
			return getVmAccessor(path);
		};
		window.vmGet = function (path) {
			return getVmValue(path);
		};
		window.vmSet = function (path, value) {
			return setVmValue(path, value);
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