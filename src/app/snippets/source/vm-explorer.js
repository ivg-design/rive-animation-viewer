({
  onLoad: () => {
    riveInst.resizeDrawingSurfaceToCanvas();
    window.refreshVmInputControls?.();

    const rootVM = riveInst.viewModelInstance;
    if (!rootVM) {
      console.warn("No viewModelInstance bound on riveInst.");
      return;
    }

    function getVmAccessorInfo(path) {
      if (!rootVM) {
        console.warn("No root ViewModelInstance.");
        return null;
      }
      const cleanPath = (path || "").trim();
      if (!cleanPath) {
        console.warn("Path is empty; must end with a property name.");
        return null;
      }

      const numberAcc = rootVM.number && rootVM.number(cleanPath);
      const boolAcc = !numberAcc && rootVM.boolean && rootVM.boolean(cleanPath);
      const stringAcc = !numberAcc && !boolAcc && rootVM.string && rootVM.string(cleanPath);
      const enumAcc = !numberAcc && !boolAcc && !stringAcc && rootVM.enum && rootVM.enum(cleanPath);
      const colorAcc = !numberAcc && !boolAcc && !stringAcc && !enumAcc && rootVM.color && rootVM.color(cleanPath);
      const triggerAcc = !numberAcc && !boolAcc && !stringAcc && !enumAcc && !colorAcc && rootVM.trigger && rootVM.trigger(cleanPath);

      const acc = numberAcc || boolAcc || stringAcc || enumAcc || colorAcc || triggerAcc;
      if (!acc) {
        console.warn("No accessor found for path:", cleanPath);
        return null;
      }
      return {
        path: cleanPath,
        kind: numberAcc ? "number" : boolAcc ? "boolean" : stringAcc ? "string" : enumAcc ? "enum" : colorAcc ? "color" : "trigger",
        accessor: acc,
      };
    }

    function getVmAccessor(path) {
      const info = getVmAccessorInfo(path);
      return info ? info.accessor : null;
    }

    function getVmValue(path) {
      const info = getVmAccessorInfo(path);
      if (!info) return undefined;
      if (info.kind === "trigger") return "(trigger)";
      return info.accessor ? info.accessor.value : undefined;
    }

    function setVmValue(path, newValue) {
      const info = getVmAccessorInfo(path);
      if (!info || !info.accessor) return undefined;
      if (info.kind === "trigger") {
        if (info.accessor.trigger) info.accessor.trigger();
        return true;
      }
      info.accessor.value = newValue;
      return info.accessor.value;
    }

    function fireVmTrigger(path) {
      const info = getVmAccessorInfo(path);
      if (!info || info.kind !== "trigger" || !info.accessor) {
        console.warn("No trigger accessor found at path:", path);
        return false;
      }
      if (info.accessor.trigger) info.accessor.trigger();
      return true;
    }

    const vmTree = { path: "<root>", scalars: [], children: {} };
    const scalarPaths = [];
    const vmInputs = [];
    const activeInstances = new WeakSet();

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
      for (let index = 0; index < vmInputs.length; index += 1) {
        if (vmInputs[index].path === path) return;
      }
      vmInputs.push({ path, kind });
    }

    function buildTree(instance, basePath, parentNode) {
      if (!instance || !instance.properties) return;
      if (activeInstances.has(instance)) return;
      activeInstances.add(instance);

      const props = instance.properties;
      for (let index = 0; index < props.length; index += 1) {
        const prop = props[index];
        const name = prop.name;
        const fullPath = basePath ? `${basePath}/${name}` : name;
        const childNode = ensureChildNode(parentNode, fullPath, name);
        const accessorInfo = getVmAccessorInfo(fullPath);
        if (accessorInfo) {
          const { kind } = accessorInfo;
          const value = kind === "trigger" ? "(trigger)" : (accessorInfo.accessor ? accessorInfo.accessor.value : null);
          childNode.scalars.push({ name, path: fullPath, kind, value });
          scalarPaths.push(fullPath);
          addVmInput(fullPath, kind);
        }

        const nestedInst = (instance.viewModelInstance && instance.viewModelInstance(name)) || (instance.viewModel && instance.viewModel(name));
        if (nestedInst && nestedInst !== instance) {
          buildTree(nestedInst, fullPath, childNode);
        }

        const list = instance.list && instance.list(name);
        const listLength = list && typeof list.length === "number" ? list.length : (list && typeof list.size === "number" ? list.size : 0);
        if (list && listLength > 0) {
          for (let itemIndex = 0; itemIndex < listLength; itemIndex += 1) {
            const instAt = list.instanceAt && list.instanceAt(itemIndex);
            if (!instAt) continue;
            const idxSeg = String(itemIndex);
            const itemPath = `${fullPath}/${idxSeg}`;
            const listNode = ensureChildNode(childNode, itemPath, idxSeg);
            buildTree(instAt, itemPath, listNode);
          }
        }
      }

      activeInstances.delete(instance);
    }

    buildTree(rootVM, "", vmTree);
    console.log("VM Explorer loaded. Found", scalarPaths.length, "scalar properties.");

    function exploreVmLevel(pathPrefix) {
      const clean = (pathPrefix || "").trim();
      let node = vmTree;
      let currentInstance = rootVM;
      if (clean !== "" && clean !== "<root>") {
        const segs = clean.split("/");
        for (let index = 0; index < segs.length; index += 1) {
          const seg = segs[index].trim();
          if (!seg) continue;
          if (!node.children[seg]) {
            console.warn("No tree node for prefix:", clean);
            return null;
          }
          node = node.children[seg];
          if (currentInstance.viewModelInstance && currentInstance.viewModelInstance(seg)) {
            currentInstance = currentInstance.viewModelInstance(seg);
          } else if (currentInstance.viewModel && currentInstance.viewModel(seg)) {
            currentInstance = currentInstance.viewModel(seg);
          }
        }
      }

      const rows = [];
      for (let index = 0; index < node.scalars.length; index += 1) {
        const sc = node.scalars[index];
        let scalarValue;

        if (sc.kind === "number" && currentInstance.number) {
          const numAcc = currentInstance.number(sc.name);
          scalarValue = numAcc ? numAcc.value : getVmValue(sc.path);
        } else if (sc.kind === "boolean" && currentInstance.boolean) {
          const boolAcc = currentInstance.boolean(sc.name);
          scalarValue = boolAcc ? boolAcc.value : getVmValue(sc.path);
        } else if (sc.kind === "string" && currentInstance.string) {
          const strAcc = currentInstance.string(sc.name);
          scalarValue = strAcc ? strAcc.value : getVmValue(sc.path);
        } else if (sc.kind === "enum" && currentInstance.enum) {
          const enumAcc = currentInstance.enum(sc.name);
          scalarValue = enumAcc ? enumAcc.value : getVmValue(sc.path);
        } else if (sc.kind === "color" && currentInstance.color) {
          const colorAcc = currentInstance.color(sc.name);
          scalarValue = colorAcc ? colorAcc.value : getVmValue(sc.path);
        } else if (sc.kind === "trigger") {
          scalarValue = "(trigger)";
        } else {
          scalarValue = getVmValue(sc.path);
        }

        rows.push({ type: "scalar", path: sc.path, name: sc.name, kind: sc.kind, value: scalarValue });
      }

      const childKeys = Object.keys(node.children).sort();
      for (let index = 0; index < childKeys.length; index += 1) {
        const key = childKeys[index];
        const child = node.children[key];
        rows.push({ type: "node", path: child.path, name: key, kind: "viewModel", value: "[node]" });
      }

      console.table(rows);
      return rows;
    }

    window.vmRootInstance = rootVM;
    window.vmTree = vmTree;
    window.vmInputs = vmInputs;
    window.vmPaths = scalarPaths.slice().sort();
    window.vmExplore = exploreVmLevel;
    window.vmGet = getVmValue;
    window.vmSet = setVmValue;
    window.vmFire = fireVmTrigger;
    window.vmAccessor = getVmAccessor;

    console.log("Helpers: vmExplore(prefix), vmGet(path), vmSet(path, value), vmFire(path)");
  },
})
