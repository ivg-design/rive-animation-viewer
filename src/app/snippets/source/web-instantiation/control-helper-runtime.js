function safeRavVmCall(target, methodName, ...args) {
  if (!target || typeof target[methodName] !== "function") return null;
  try {
    return target[methodName](...args);
  } catch {
    return null;
  }
}

function getRavVmRoot(instance = riveInst) {
  if (!instance) return null;
  if (instance.viewModelInstance) return instance.viewModelInstance;
  try {
    const defaultViewModel = typeof instance.defaultViewModel === "function"
      ? instance.defaultViewModel()
      : null;
    if (!defaultViewModel) return null;
    if (typeof defaultViewModel.defaultInstance === "function") {
      return defaultViewModel.defaultInstance();
    }
    if (typeof defaultViewModel.instance === "function") {
      return defaultViewModel.instance();
    }
  } catch {
    return null;
  }
  return null;
}

function getRavVmAccessor(path, expectedKind, instance = riveInst) {
  const rootVm = getRavVmRoot(instance);
  if (!rootVm || typeof path !== "string" || !path) return null;
  const segments = path.includes("/") ? path.split("/") : [path];
  const propertyName = segments.pop();
  let current = rootVm;
  let index = 0;

  while (index < segments.length && current) {
    const segment = segments[index];
    const directChild = safeRavVmCall(current, "viewModel", segment)
      || safeRavVmCall(current, "viewModelInstance", segment);
    if (directChild) {
      current = directChild;
      index += 1;
      continue;
    }

    if (index + 1 < segments.length) {
      const listAccessor = safeRavVmCall(current, "list", segment);
      const listIndex = Number.parseInt(segments[index + 1], 10);
      if (listAccessor && Number.isFinite(listIndex) && typeof listAccessor.instanceAt === "function") {
        try {
          const nextItem = listAccessor.instanceAt(listIndex);
          if (nextItem) {
            current = nextItem;
            index += 2;
            continue;
          }
        } catch {
          return null;
        }
      }
    }

    return null;
  }

  if (!current || !propertyName) return null;
  const probes = [
    ["number", "number"],
    ["boolean", "boolean"],
    ["string", "string"],
    ["enum", "enum"],
    ["color", "color"],
    ["trigger", "trigger"],
  ];

  for (const [kind, methodName] of probes) {
    const accessor = safeRavVmCall(current, methodName, propertyName);
    if (accessor && (!expectedKind || expectedKind === kind)) {
      return accessor;
    }
  }
  return null;
}

function getRavStateMachineInput(stateMachineName, inputName, instance = riveInst) {
  if (!instance || typeof instance.stateMachineInputs !== "function" || !stateMachineName || !inputName) {
    return null;
  }
  try {
    const inputs = instance.stateMachineInputs(stateMachineName);
    if (!Array.isArray(inputs)) return null;
    return inputs.find((candidate) => candidate && candidate.name === inputName) || null;
  } catch {
    return null;
  }
}

function isRavStateMachineTriggerInput(input) {
  if (!input) return false;
  const triggerType = typeof rive !== "undefined"
    ? rive?.StateMachineInputType?.Trigger
    : undefined;
  if (triggerType !== undefined && input.type === triggerType) return true;
  return typeof input.fire === "function" && !("value" in input);
}

function parseRavArgbHex(value) {
  const cleanValue = typeof value === "string" ? value.trim() : "";
  const normalized = cleanValue.startsWith("#") ? cleanValue.slice(1) : cleanValue;
  if (!/^[0-9a-fA-F]{8}$/.test(normalized)) return null;
  return Number.parseInt(normalized, 16) >>> 0;
}

function setRavVmValue(path, value, expectedKind, instance = riveInst) {
  const colorValue = expectedKind === "color"
    ? typeof value === "number" && Number.isFinite(value)
      ? value >>> 0
      : parseRavArgbHex(value)
    : parseRavArgbHex(value);
  const probeKinds = expectedKind
    ? [expectedKind]
    : typeof value === "boolean"
      ? ["boolean"]
      : typeof value === "number"
        ? ["number"]
        : colorValue !== null
          ? ["color"]
          : ["enum", "string"];

  for (const kind of probeKinds) {
    const accessor = getRavVmAccessor(path, kind, instance);
    if (!accessor || !("value" in accessor)) continue;
    accessor.value = kind === "color" ? colorValue : value;
    return true;
  }
  return false;
}

function fireRavVmTrigger(path, instance = riveInst) {
  const accessor = getRavVmAccessor(path, "trigger", instance);
  if (accessor && typeof accessor.trigger === "function") {
    accessor.trigger();
    return true;
  }
  if (accessor && typeof accessor.fire === "function") {
    accessor.fire();
    return true;
  }
  return false;
}

function setRavStateMachineInput(stateMachineName, inputName, value, instance = riveInst) {
  const input = getRavStateMachineInput(stateMachineName, inputName, instance);
  if (!input || isRavStateMachineTriggerInput(input) || !("value" in input)) return false;
  input.value = value;
  return true;
}

function fireRavStateMachineInput(stateMachineName, inputName, instance = riveInst) {
  const input = getRavStateMachineInput(stateMachineName, inputName, instance);
  if (!input || !isRavStateMachineTriggerInput(input) || typeof input.fire !== "function") return false;
  input.fire();
  return true;
}

function resolveRavVmOverrides(overrides = undefined) {
  if (overrides && typeof overrides === "object") return overrides;
  if (typeof VM_OVERRIDES !== "undefined" && VM_OVERRIDES && typeof VM_OVERRIDES === "object") {
    return VM_OVERRIDES;
  }
  return null;
}

function resolveRavStateMachineOverrides(overrides = undefined) {
  if (overrides && typeof overrides === "object") return overrides;
  if (typeof STATE_MACHINE_OVERRIDES !== "undefined"
      && STATE_MACHINE_OVERRIDES
      && typeof STATE_MACHINE_OVERRIDES === "object") {
    return STATE_MACHINE_OVERRIDES;
  }
  return null;
}

function resolveRavVmTriggerPaths(vmTriggers = undefined) {
  if (Array.isArray(vmTriggers)) return vmTriggers;
  if (typeof VM_TRIGGER_PATHS !== "undefined" && Array.isArray(VM_TRIGGER_PATHS)) {
    return VM_TRIGGER_PATHS;
  }
  return [];
}

function resolveRavStateMachineTriggerInputs(stateMachineTriggers = undefined) {
  if (Array.isArray(stateMachineTriggers)) return stateMachineTriggers;
  if (typeof STATE_MACHINE_TRIGGER_INPUTS !== "undefined" && Array.isArray(STATE_MACHINE_TRIGGER_INPUTS)) {
    return STATE_MACHINE_TRIGGER_INPUTS;
  }
  return [];
}

function applyRavVmOverrides(instance = riveInst, overrides = undefined) {
  const resolvedOverrides = resolveRavVmOverrides(overrides);
  if (!instance || !resolvedOverrides) return 0;
  let applied = 0;
  Object.entries(resolvedOverrides).forEach(([path, value]) => {
    if (setRavVmValue(path, value, undefined, instance)) applied += 1;
  });
  return applied;
}

function applyRavStateMachineOverrides(instance = riveInst, overrides = undefined) {
  const resolvedOverrides = resolveRavStateMachineOverrides(overrides);
  if (!instance || !resolvedOverrides) return 0;
  let applied = 0;
  Object.entries(resolvedOverrides).forEach(([stateMachineName, inputs]) => {
    if (!inputs || typeof inputs !== "object") return;
    Object.entries(inputs).forEach(([inputName, value]) => {
      if (setRavStateMachineInput(stateMachineName, inputName, value, instance)) applied += 1;
    });
  });
  return applied;
}

function fireRavConfiguredTriggers(instance = riveInst, vmTriggers = undefined, stateMachineTriggers = undefined) {
  const resolvedVmTriggers = resolveRavVmTriggerPaths(vmTriggers);
  const resolvedStateMachineTriggers = resolveRavStateMachineTriggerInputs(stateMachineTriggers);
  let fired = 0;
  if (Array.isArray(resolvedVmTriggers)) {
    resolvedVmTriggers.forEach((path) => {
      if (fireRavVmTrigger(path, instance)) fired += 1;
    });
  }
  if (Array.isArray(resolvedStateMachineTriggers)) {
    resolvedStateMachineTriggers.forEach((entry) => {
      if (fireRavStateMachineInput(entry?.stateMachine, entry?.input, instance)) fired += 1;
    });
  }
  return fired;
}

function applyRavControlSnapshot(instance = riveInst) {
  if (!instance) return 0;
  // Snapshot restores value-like overrides only. Triggers remain manual.
  let applied = 0;
  applied += applyRavVmOverrides(instance);
  applied += applyRavStateMachineOverrides(instance);
  return applied;
}

function createRavWebController(getInstance) {
  return {
    get instance() {
      return getInstance();
    },
    applySnapshot() {
      return applyRavControlSnapshot(getInstance());
    },
    applyStateMachineOverrides() {
      return applyRavStateMachineOverrides(getInstance());
    },
    applyVmOverrides() {
      return applyRavVmOverrides(getInstance());
    },
    fireConfiguredTriggers() {
      return fireRavConfiguredTriggers(getInstance());
    },
    fireStateMachineInput(stateMachineName, inputName) {
      return fireRavStateMachineInput(stateMachineName, inputName, getInstance());
    },
    fireVmTrigger(path) {
      return fireRavVmTrigger(path, getInstance());
    },
    getStateMachineInput(stateMachineName, inputName) {
      return getRavStateMachineInput(stateMachineName, inputName, getInstance());
    },
    getVmRoot() {
      return getRavVmRoot(getInstance());
    },
    resolveVmAccessor(path, expectedKind) {
      return getRavVmAccessor(path, expectedKind, getInstance());
    },
    setStateMachineInput(stateMachineName, inputName, value) {
      return setRavStateMachineInput(stateMachineName, inputName, value, getInstance());
    },
    setVmValue(path, value, expectedKind) {
      return setRavVmValue(path, value, expectedKind, getInstance());
    },
  };
}

const ravRive = createRavWebController(() => riveInst);
