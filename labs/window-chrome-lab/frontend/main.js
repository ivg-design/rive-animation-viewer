(function () {
  const stateGrid = document.getElementById("state-grid");
  const logOutput = document.getElementById("log-output");
  const titlebarState = document.getElementById("titlebar-state");
  const windowControls = document.getElementById("window-controls");
  const clearLogButton = document.getElementById("clear-log-btn");
  const refreshStateButton = document.getElementById("refresh-state-btn");
  const jsMinimizeButton = document.getElementById("js-minimize-btn");
  const rustMinimizeButton = document.getElementById("rust-minimize-btn");
  const restoreButton = document.getElementById("restore-btn");
  const jsProbeResult = document.getElementById("js-probe-result");
  const rustProbeResult = document.getElementById("rust-probe-result");

  const tauriWindow = window.__TAURI__?.window?.getCurrentWindow?.();
  const tauriCore = window.__TAURI__?.core;

  function timestamp() {
    return new Date().toLocaleTimeString("en-US", { hour12: false });
  }

  function log(message, detail) {
    const suffix = detail == null ? "" : ` ${JSON.stringify(detail)}`;
    logOutput.textContent = `[${timestamp()}] ${message}${suffix}\n${logOutput.textContent}`;
  }

  async function collectWindowState() {
    if (!tauriWindow) {
      return {
        available: false
      };
    }
    return {
      available: true,
      label: tauriWindow.label,
      focused: await tauriWindow.isFocused(),
      minimized: await tauriWindow.isMinimized(),
      maximized: await tauriWindow.isMaximized(),
      decorated: await tauriWindow.isDecorated(),
      visible: await tauriWindow.isVisible(),
      minimizable: await tauriWindow.isMinimizable(),
      maximizable: await tauriWindow.isMaximizable(),
      closable: await tauriWindow.isClosable()
    };
  }

  function renderState(state) {
    stateGrid.innerHTML = Object.entries(state)
      .map(([key, value]) => `<dt>${key}</dt><dd>${String(value)}</dd>`)
      .join("");
    titlebarState.textContent = state.available
      ? `minimized=${state.minimized} · maximized=${state.maximized} · focused=${state.focused}`
      : "window.__TAURI__ unavailable";
  }

  async function refreshState(reason) {
    const state = await collectWindowState();
    renderState(state);
    if (reason) {
      log(`refreshed state after ${reason}`, state);
    }
    return state;
  }

  async function invokeRust(command) {
    if (!tauriCore?.invoke) {
      throw new Error("window.__TAURI__.core.invoke unavailable");
    }
    return tauriCore.invoke(command);
  }

  async function runJsMinimizeProbe() {
    log("starting JS minimize probe");
    await tauriWindow.minimize();
    await new Promise((resolve) => setTimeout(resolve, 360));
    const minimized = await tauriWindow.isMinimized();
    log("JS minimize probe result", { minimized });
    jsProbeResult.textContent = minimized ? "pass" : "fail";
    jsProbeResult.dataset.state = minimized ? "pass" : "fail";
    if (minimized) {
      await tauriWindow.unminimize();
      log("JS minimize probe restored window");
    }
    await new Promise((resolve) => setTimeout(resolve, 220));
    await refreshState("JS minimize probe");
  }

  async function runRustMinimizeProbe() {
    log("starting Rust minimize probe");
    const result = await invokeRust("rust_probe_minimize");
    log("Rust minimize probe result", result);
    const passed = Boolean(result?.after_minimize) && !Boolean(result?.after_restore);
    rustProbeResult.textContent = passed ? "pass" : "fail";
    rustProbeResult.dataset.state = passed ? "pass" : "fail";
    await refreshState("Rust minimize probe");
  }

  async function restoreWindow() {
    log("restoring window");
    await tauriWindow.unminimize();
    if (await tauriWindow.isMaximized()) {
      await tauriWindow.toggleMaximize();
    }
    await refreshState("restore");
  }

  async function handleWindowControl(action) {
    if (!tauriWindow) {
      return;
    }
    log(`window control: ${action}`);
    if (action === "minimize") {
      await tauriWindow.minimize();
    } else if (action === "maximize") {
      await tauriWindow.toggleMaximize();
    } else if (action === "close") {
      await tauriWindow.close();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 180));
    await refreshState(`window control ${action}`);
  }

  function bind() {
    windowControls.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) {
        return;
      }
      await handleWindowControl(button.dataset.action);
    });

    clearLogButton.addEventListener("click", () => {
      logOutput.textContent = "";
    });

    refreshStateButton.addEventListener("click", () => {
      void refreshState("manual refresh");
    });

    jsMinimizeButton.addEventListener("click", () => {
      void runJsMinimizeProbe();
    });

    rustMinimizeButton.addEventListener("click", () => {
      void runRustMinimizeProbe();
    });

    restoreButton.addEventListener("click", () => {
      void restoreWindow();
    });
  }

  async function boot() {
    bind();
    log("boot", {
      tauriWindow: Boolean(tauriWindow),
      invoke: Boolean(tauriCore?.invoke)
    });
    await refreshState("boot");
    setTimeout(() => {
      void runJsMinimizeProbe();
    }, 900);
    setTimeout(() => {
      void runRustMinimizeProbe();
    }, 2600);
  }

  void boot();
})();
