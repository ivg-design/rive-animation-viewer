function createRavWebController(getInstance) {
  let pendingVmOverrides = new Map();
  let pendingGlobalVmOverrides = new Map();
  let pendingStateMachineOverrides = new Map();
  let retryGeneration = 0;
  let advanceRetryBudget = 0;

  const resetPendingSnapshot = () => {
    advanceRetryBudget = 600;
    pendingVmOverrides = new Map(Object.entries(resolveRavVmOverrides() || {}));
    pendingGlobalVmOverrides = new Map();
    Object.entries(resolveRavGlobalVmOverrides() || {}).forEach(([name, values]) => {
      Object.entries(values || {}).forEach(([path, value]) => {
        pendingGlobalVmOverrides.set(`${name}\u0000${path}`, { name, path, value });
      });
    });
    pendingStateMachineOverrides = new Map();
    Object.entries(resolveRavStateMachineOverrides() || {}).forEach(([stateMachineName, inputs]) => {
      Object.entries(inputs || {}).forEach(([inputName, value]) => {
        pendingStateMachineOverrides.set(`${stateMachineName}/${inputName}`, { inputName, stateMachineName, value });
      });
    });
  };

  const applyPendingSnapshot = () => {
    const instance = getInstance();
    let applied = 0;
    pendingVmOverrides.forEach((value, path) => {
      if (setRavVmValue(path, value, undefined, instance)) {
        pendingVmOverrides.delete(path);
        applied += 1;
      }
    });
    pendingGlobalVmOverrides.forEach((entry, key) => {
      if (setRavGlobalVmValue(entry.name, entry.path, entry.value, undefined, instance)) {
        pendingGlobalVmOverrides.delete(key);
        applied += 1;
      }
    });
    pendingStateMachineOverrides.forEach((entry, key) => {
      if (setRavStateMachineInput(entry.stateMachineName, entry.inputName, entry.value, instance)) {
        pendingStateMachineOverrides.delete(key);
        applied += 1;
      }
    });
    return applied;
  };

  const hasPendingSnapshot = () => pendingVmOverrides.size + pendingGlobalVmOverrides.size + pendingStateMachineOverrides.size > 0;
  const prepareSnapshot = () => {
    retryGeneration += 1;
    resetPendingSnapshot();
    return applyPendingSnapshot();
  };
  const schedulePendingSnapshot = () => {
    if (!hasPendingSnapshot()) return;
    const generation = ++retryGeneration;
    let remainingFrames = 180;
    const schedule = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (callback) => setTimeout(callback, 16);
    const retry = () => {
      if (generation !== retryGeneration) return;
      applyPendingSnapshot();
      if (hasPendingSnapshot() && remainingFrames-- > 0) schedule(retry);
    };
    schedule(retry);
  };

  const runOnLoad = (callback, args = []) => {
    prepareSnapshot();
    const instance = getInstance();
    const originalBind = instance?.bindViewModelInstance;
    const hadOwnBind = Object.prototype.hasOwnProperty.call(instance || {}, "bindViewModelInstance");
    let wrapped = false;
    if (hasPendingSnapshot() && typeof originalBind === "function") {
      try {
        instance.bindViewModelInstance = function (...bindArgs) {
          const result = originalBind.apply(this, bindArgs);
          applyPendingSnapshot();
          return result;
        };
        wrapped = instance.bindViewModelInstance !== originalBind;
      } catch { /* runtime method is not writable */ }
    }
    try {
      return typeof callback === "function" ? callback(...args) : undefined;
    } finally {
      if (wrapped) {
        try {
          if (hadOwnBind) instance.bindViewModelInstance = originalBind;
          else delete instance.bindViewModelInstance;
        } catch { /* noop */ }
      }
      applyPendingSnapshot();
      schedulePendingSnapshot();
    }
  };

  return {
    get instance() { return getInstance(); },
    applySnapshot() { const applied = prepareSnapshot(); schedulePendingSnapshot(); return applied; },
    applyStateMachineOverrides() { return applyRavStateMachineOverrides(getInstance()); },
    applyGlobalVmOverrides() { return applyRavGlobalVmOverrides(getInstance()); },
    applyVmOverrides() { return applyRavVmOverrides(getInstance()); },
    fireConfiguredTriggers() { return fireRavConfiguredTriggers(getInstance()); },
    fireStateMachineInput(name, input) { return fireRavStateMachineInput(name, input, getInstance()); },
    fireVmTrigger(path) { return fireRavVmTrigger(path, getInstance()); },
    fireGlobalVmTrigger(name, path) { return fireRavGlobalVmTrigger(name, path, getInstance()); },
    getStateMachineInput(name, input) { return getRavStateMachineInput(name, input, getInstance()); },
    getVmRoot() { return getRavVmRoot(getInstance()); },
    getGlobalVmRoot(name) { return getRavGlobalVmRoot(name, getInstance()); },
    resolveVmAccessor(path, kind) { return getRavVmAccessor(path, kind, getInstance()); },
    resolveGlobalVmAccessor(name, path, kind) { return getRavGlobalVmAccessor(name, path, kind, getInstance()); },
    retryPendingSnapshot() { return applyPendingSnapshot(); },
    retryPendingSnapshotOnAdvance() {
      if (!hasPendingSnapshot() || advanceRetryBudget <= 0) return 0;
      advanceRetryBudget -= 1;
      return applyPendingSnapshot();
    },
    runOnLoad,
    setStateMachineInput(name, input, value) { return setRavStateMachineInput(name, input, value, getInstance()); },
    setVmValue(path, value, kind) { return setRavVmValue(path, value, kind, getInstance()); },
    setGlobalVmValue(name, path, value, kind) { return setRavGlobalVmValue(name, path, value, kind, getInstance()); },
  };
}

const ravRive = createRavWebController(() => riveInst);
