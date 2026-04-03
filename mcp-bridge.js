/**
 * RAV MCP Bridge Client
 *
 * Connects to the RAV MCP server's WebSocket bridge and handles commands.
 * This module is loaded by app.js and has access to all RAV globals via
 * the window object.
 *
 * Connection flow:
 *   1. On page load, attempts to connect to ws://127.0.0.1:<configured-port>
 *   2. If the MCP server is running, connection succeeds and commands flow
 *   3. If not running, silently retries every 5 seconds
 *   4. Auto-reconnects on disconnect
 *
 * No UI impact — the bridge is invisible unless inspecting the console.
 */

const DEFAULT_MCP_BRIDGE_PORT = 9274;
const MCP_SCRIPT_ACCESS_STORAGE_KEY = 'rav-mcp-script-access-enabled';
const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 4000;
const CONNECT_TIMEOUT_MS = 2000;
const WATCHDOG_INTERVAL_MS = 1500;

function normalizeBridgePort(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : DEFAULT_MCP_BRIDGE_PORT;
}

function readInitialBridgePort() {
  const explicitPort = window.__RAV_MCP_PORT__;
  if (explicitPort) {
    return normalizeBridgePort(explicitPort);
  }
  try {
    return normalizeBridgePort(window.localStorage?.getItem('rav-mcp-port'));
  } catch {
    return DEFAULT_MCP_BRIDGE_PORT;
  }
}

function persistBridgePort(port) {
  try {
    window.localStorage?.setItem('rav-mcp-port', String(port));
  } catch {
    /* noop */
  }
  window.__RAV_MCP_PORT__ = port;
}

let bridgePort = readInitialBridgePort();
let ws = null;
let reconnectTimer = null;
let reconnectDelay = RECONNECT_DELAY_MS;
let connected = false;
let enabled = true;
let connectionAttempts = 0;
let connectTimeoutTimer = null;
let connectStartedAt = 0;
let watchdogTimer = null;
let bridgePortSyncPromise = null;
let connectPromise = null;

function getBridgeUrl() {
  return `ws://127.0.0.1:${bridgePort}`;
}

function getTauriInvoker() {
  if (window.__TAURI_INTERNALS__?.invoke) {
    return window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
  }
  if (window.__TAURI__?.core?.invoke) {
    return window.__TAURI__.core.invoke.bind(window.__TAURI__.core);
  }
  if (window.__TAURI__?.invoke) {
    return window.__TAURI__.invoke.bind(window.__TAURI__);
  }
  return null;
}

async function invokeDesktop(command, args = {}) {
  const invoke = getTauriInvoker();
  if (!invoke) {
    return null;
  }
  try {
    return await invoke(command, args);
  } catch (error) {
    console.warn(`[rav-mcp-bridge] ${command} failed:`, error);
    return null;
  }
}

async function syncBridgePortFromDesktop() {
  if (bridgePortSyncPromise) {
    return bridgePortSyncPromise;
  }

  bridgePortSyncPromise = (async () => {
    const resolvedPort = await invokeDesktop('get_mcp_port');
    if (resolvedPort === null || resolvedPort === undefined || resolvedPort === '') {
      return bridgePort;
    }
    const normalizedPort = normalizeBridgePort(resolvedPort);
    if (normalizedPort !== bridgePort) {
      bridgePort = normalizedPort;
      persistBridgePort(bridgePort);
    }
    return bridgePort;
  })();

  try {
    return await bridgePortSyncPromise;
  } finally {
    bridgePortSyncPromise = null;
  }
}

function isMcpScriptAccessEnabled() {
  if (typeof window.__RAV_MCP_SCRIPT_ACCESS__ === 'boolean') {
    return window.__RAV_MCP_SCRIPT_ACCESS__;
  }
  try {
    return window.localStorage?.getItem(MCP_SCRIPT_ACCESS_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function assertMcpScriptAccess(commandName) {
  if (isMcpScriptAccessEnabled()) {
    return;
  }
  throw new Error(
    `MCP script access is disabled. Enable Script Access in the MCP setup dialog to use ${commandName}.`,
  );
}

// ---------------------------------------------------------------------------
// Command handlers — each returns a JSON-serializable value
// ---------------------------------------------------------------------------

function buildViewModelSnapshot() {
  const inst = window.riveInst;
  const directVm = inst?.viewModelInstance || null;

  if (window.vmTree) {
    return {
      hasRoot: !!(window.vmRootInstance || directVm),
      tree: window.vmTree,
      paths: window.vmPaths || [],
      inputs: window.vmInputs || [],
    };
  }

  if (!inst) {
    return {
      hasRoot: false,
      tree: null,
      paths: [],
      inputs: [],
      message: 'No animation loaded',
    };
  }

  if (!directVm) {
    return {
      hasRoot: false,
      tree: null,
      paths: [],
      inputs: [],
      message: 'No ViewModel bound — ensure autoBind: true',
    };
  }

  const accessorKinds = ['number', 'boolean', 'string', 'enum', 'color', 'trigger'];
  const inputs = [];

  function walkVm(instance, basePath) {
    const node = { label: basePath || 'root', path: basePath || '', inputs: [], children: [] };
    const props = instance.properties || [];
    for (const prop of props) {
      const name = prop?.name;
      if (!name) continue;
      const fullPath = basePath ? `${basePath}/${name}` : name;

      for (const kind of accessorKinds) {
        try {
          const accessor = instance[kind]?.(name);
          if (accessor !== undefined && accessor !== null) {
            let value;
            if (kind === 'trigger') {
              value = null;
            } else {
              try { value = accessor.value; } catch { value = null; }
            }
            const entry = { name, path: fullPath, kind, value };
            node.inputs.push(entry);
            inputs.push(entry);
            break;
          }
        } catch { /* accessor not available for this kind */ }
      }

      try {
        const nested = instance.viewModelInstance?.(name) || instance.viewModel?.(name);
        if (nested && nested !== instance && nested.properties) {
          node.children.push(walkVm(nested, fullPath));
        }
      } catch { /* not a nested VM */ }
    }
    return node;
  }

  const tree = walkVm(directVm, '');
  return {
    hasRoot: true,
    tree,
    paths: inputs.map((input) => input.path),
    inputs,
  };
}

const commandHandlers = {

  async rav_status() {
    const inst = window.riveInst;
    const vmSnapshot = buildViewModelSnapshot();
    const liveConfigState = window._mcpGetLiveConfigState?.() || { draftDirty: false, sourceMode: 'internal' };
    const status = {
      connected: true,
      file: {
        name: window.__riveAnimationCache?.getName() || null,
        loaded: !!inst,
        sizeBytes: inst ? (window.__riveAnimationCache?.getBuffer()?.byteLength || 0) : 0,
      },
      runtime: {
        name: document.getElementById('runtime-select')?.value || 'unknown',
        version: window.__riveRuntimeCache?.getRuntimeVersion() || 'unknown',
      },
      playback: {
        isPlaying: inst ? inst.isPlaying : false,
        isPaused: inst ? inst.isStopped || !inst.isPlaying : true,
      },
      layout: {
        fit: document.getElementById('layout-select')?.value || 'contain',
        alignment: document.getElementById('alignment-select')?.value || 'center',
        canvasColor: document.getElementById('canvas-color-input')?.value || '#0d1117',
      },
      viewModel: {
        hasRoot: vmSnapshot.hasRoot,
        pathCount: vmSnapshot.paths.length,
      },
      instantiation: {
        draftDirty: Boolean(liveConfigState.draftDirty),
        sourceMode: liveConfigState.sourceMode || 'internal',
      },
      artboard: window._mcpGetArtboardState?.() || null,
    };
    return status;
  },

  async rav_switch_artboard({ artboard, playback }) {
    if (!artboard) throw new Error('artboard is required');
    if (typeof window._mcpSwitchArtboard !== 'function') throw new Error('Artboard switcher not available');
    await window._mcpSwitchArtboard(artboard, playback || null);
    return { ok: true, artboard, playback };
  },

  async rav_reset_artboard() {
    if (typeof window._mcpResetArtboard !== 'function') throw new Error('Artboard switcher not available');
    window._mcpResetArtboard();
    return { ok: true };
  },

  async rav_open_file({ path }) {
    if (!path) throw new Error('path is required');

    // If running in Tauri, use the Tauri bridge to read the file
    const invoke = window.__TAURI_INTERNALS__?.invoke
      || window.__TAURI__?.core?.invoke
      || window.__TAURI__?.invoke;

    if (!invoke) {
      throw new Error(
        'File opening requires the Tauri desktop app. ' +
        'In the browser, drag and drop a .riv file onto the canvas instead.'
      );
    }

    // Read file via Tauri IPC
    const base64 = await invoke('read_riv_file', { path });
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const buffer = bytes.buffer;
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const fileUrl = URL.createObjectURL(blob);

    const fileName = path.split('/').pop() || path.split('\\').pop() || 'unknown.riv';

    let transferredToSession = false;
    try {
      if (typeof window._mcpSetCurrentFile !== 'function') {
        throw new Error('Current file bridge is unavailable');
      }
      if (typeof window._mcpLoadAnimation !== 'function') {
        throw new Error('Animation loader bridge is unavailable');
      }
      window._mcpSetCurrentFile(fileUrl, fileName, true, buffer, blob.type, buffer.byteLength, {
        sourcePath: path,
      });
      transferredToSession = true;
      await window._mcpLoadAnimation(fileUrl, fileName, { forceAutoplay: true });
      return { ok: true, file: fileName, sizeBytes: buffer.byteLength };
    } catch (error) {
      if (!transferredToSession) {
        URL.revokeObjectURL(fileUrl);
      }
      throw error;
    }
  },

  async rav_play() {
    if (typeof window.play === 'function') {
      window.play();
      return { ok: true };
    }
    throw new Error('No play function available');
  },

  async rav_pause() {
    if (typeof window.pause === 'function') {
      window.pause();
      return { ok: true };
    }
    throw new Error('No pause function available');
  },

  async rav_reset() {
    if (typeof window.reset === 'function') {
      await window.reset();
      return { ok: true };
    }
    throw new Error('No reset function available');
  },

  async rav_get_artboards() {
    const inst = window.riveInst;
    if (!inst) throw new Error('No animation loaded');

    // contents is a property, not a function
    const contents = inst.contents;
    if (contents?.artboards) {
      return {
        artboards: contents.artboards.map(ab =>
          typeof ab === 'string' ? { name: ab } : ab
        ),
      };
    }

    // Fallback: single artboard name
    const name = inst.artboardName;
    return { artboards: [{ name: name || '(default)' }] };
  },

  async rav_get_state_machines() {
    const inst = window.riveInst;
    if (!inst) throw new Error('No animation loaded');

    // stateMachineNames is a property (Array), not a function
    const names = inst.stateMachineNames;
    if (Array.isArray(names) && names.length > 0) {
      return { stateMachines: names };
    }

    // Fallback: dig into contents
    const contents = inst.contents;
    if (contents?.artboards) {
      for (const ab of contents.artboards) {
        if (ab.stateMachines?.length) {
          return { stateMachines: ab.stateMachines.map(sm => sm.name || sm) };
        }
      }
    }

    return { stateMachines: [] };
  },

  async rav_get_vm_tree() {
    const inst = window.riveInst;
    if (!inst) throw new Error('No animation loaded');
    const snapshot = buildViewModelSnapshot();
    return {
      tree: snapshot.tree,
      paths: snapshot.paths,
      inputs: snapshot.inputs,
      ...(snapshot.message ? { message: snapshot.message } : {}),
    };
  },

  async rav_vm_get({ path }) {
    if (!path) throw new Error('path is required');

    // Try vm-explorer-snippet first
    if (typeof window.vmGet === 'function') {
      const value = window.vmGet(path);
      return { path, value };
    }

    // Direct access fallback
    const inst = window.riveInst;
    const vm = inst?.viewModelInstance;
    if (!vm) throw new Error('No ViewModel available');

    const parts = path.split('/');
    const propName = parts.pop();
    let current = vm;
    for (const segment of parts) {
      current = current.viewModelInstance?.(segment) || current.viewModel?.(segment);
      if (!current) throw new Error(`Cannot navigate to "${segment}" in path "${path}"`);
    }

    for (const kind of ['number', 'boolean', 'string', 'enum', 'color']) {
      try {
        const accessor = current[kind]?.(propName);
        if (accessor !== undefined && accessor !== null) {
          return { path, kind, value: accessor.value };
        }
      } catch { /* wrong kind */ }
    }
    throw new Error(`Property "${propName}" not found or not readable`);
  },

  async rav_vm_set({ path, value }) {
    if (!path) throw new Error('path is required');
    if (value === undefined) throw new Error('value is required');

    // Try vm-explorer-snippet first
    if (typeof window.vmSet === 'function') {
      window.vmSet(path, value);
      return { ok: true, path, value };
    }

    // Direct access fallback
    const inst = window.riveInst;
    const vm = inst?.viewModelInstance;
    if (!vm) throw new Error('No ViewModel available');

    const parts = path.split('/');
    const propName = parts.pop();
    let current = vm;
    for (const segment of parts) {
      current = current.viewModelInstance?.(segment) || current.viewModel?.(segment);
      if (!current) throw new Error(`Cannot navigate to "${segment}" in path "${path}"`);
    }

    for (const kind of ['number', 'boolean', 'string', 'enum', 'color']) {
      try {
        const accessor = current[kind]?.(propName);
        if (accessor !== undefined && accessor !== null) {
          accessor.value = value;
          return { ok: true, path, kind, value };
        }
      } catch { /* wrong kind */ }
    }
    throw new Error(`Property "${propName}" not found or not writable`);
  },

  async rav_vm_fire({ path }) {
    if (!path) throw new Error('path is required');

    // Try vm-explorer-snippet first
    if (typeof window.vmFire === 'function') {
      window.vmFire(path);
      return { ok: true, path };
    }

    // Direct access fallback
    const inst = window.riveInst;
    const vm = inst?.viewModelInstance;
    if (!vm) throw new Error('No ViewModel available');

    const parts = path.split('/');
    const propName = parts.pop();
    let current = vm;
    for (const segment of parts) {
      current = current.viewModelInstance?.(segment) || current.viewModel?.(segment);
      if (!current) throw new Error(`Cannot navigate to "${segment}" in path "${path}"`);
    }

    try {
      const accessor = current.trigger?.(propName);
      if (accessor) {
        // Rive VM trigger accessors use .trigger() not .fire()
        if (typeof accessor.trigger === 'function') {
          accessor.trigger();
        } else if (typeof accessor.fire === 'function') {
          accessor.fire();
        }
        return { ok: true, path };
      }
    } catch { /* not a trigger */ }
    throw new Error(`Trigger "${propName}" not found`);
  },

  async rav_get_event_log({ limit = 50, source = 'all' } = {}) {
    // Access the internal event log array via the window bridge
    const entries = window._mcpGetEventLog?.() || [];
    let filtered = entries;
    if (source && source !== 'all') {
      filtered = entries.filter(e => e.source === source);
    }
    return {
      total: entries.length,
      returned: Math.min(limit, filtered.length),
      entries: filtered.slice(0, limit),
    };
  },

  async rav_get_editor_code() {
    const code = await window._mcpGetEditorCode?.();
    if (code !== undefined) {
      return { code };
    }
    throw new Error('Editor not available');
  },

  async rav_set_editor_code({ code }) {
    if (typeof code !== 'string') throw new Error('code must be a string');
    if (typeof window._mcpSetEditorCode === 'function') {
      const applied = await window._mcpSetEditorCode(code);
      if (applied === false) {
        throw new Error('Editor not available');
      }
      return { ok: true };
    }
    throw new Error('Editor not available');
  },

  async rav_apply_code() {
    assertMcpScriptAccess('rav_apply_code');
    if (typeof window.applyCodeAndReload === 'function') {
      await window.applyCodeAndReload();
      return { ok: true };
    }
    throw new Error('applyCodeAndReload not available');
  },

  async rav_set_runtime({ runtime }) {
    if (!runtime) throw new Error('runtime is required');
    const select = document.getElementById('runtime-select');
    if (select) {
      select.value = runtime;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, runtime };
    }
    throw new Error('Runtime selector not found');
  },

  async rav_set_layout({ fit }) {
    if (!fit) throw new Error('fit is required');
    const select = document.getElementById('layout-select');
    if (select) {
      select.value = fit;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, fit };
    }
    throw new Error('Layout selector not found');
  },

  async rav_set_canvas_color({ color }) {
    if (!color) throw new Error('color is required');
    const input = document.getElementById('canvas-color-input');
    if (input) {
      if (color === 'transparent') {
        // Trigger transparency mode
        const btn = document.getElementById('transparency-mode-toggle');
        if (btn) btn.click();
        return { ok: true, color: 'transparent' };
      }
      input.value = color;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true, color };
    }
    throw new Error('Canvas color input not found');
  },

  async rav_export_demo({ output_path } = {}) {
    if (output_path && typeof window._mcpExportDemoToPath === 'function') {
      const result = await window._mcpExportDemoToPath(output_path);
      return { ok: true, path: result };
    }
    if (!output_path && typeof window.createDemoBundle === 'function') {
      const result = await window.createDemoBundle();
      return { ok: true, result: result || 'Demo export initiated (save dialog opened)' };
    }
    throw new Error('Export not available');
  },

  async generate_web_instantiation_code({ package_source = 'cdn' } = {}) {
    if (typeof window._mcpGenerateWebInstantiationCode === 'function') {
      return await window._mcpGenerateWebInstantiationCode(package_source);
    }
    throw new Error('Web instantiation generator not available');
  },

  async rav_toggle_instantiation_controls_dialog({ action = 'toggle' } = {}) {
    if (typeof window._mcpToggleInstantiationControlsDialog === 'function') {
      return await window._mcpToggleInstantiationControlsDialog(action);
    }
    throw new Error('Instantiation controls dialog not available');
  },

  async rav_get_sm_inputs() {
    const inst = window.riveInst;
    if (!inst) throw new Error('No animation loaded');

    const inputs = [];
    try {
      // stateMachineNames is a property (Array), not a function
      const smNames = Array.isArray(inst.stateMachineNames)
        ? inst.stateMachineNames : [];

      for (const smName of smNames) {
        if (typeof inst.stateMachineInputs !== 'function') continue;
        const smInputs = inst.stateMachineInputs(smName);
        if (!Array.isArray(smInputs)) continue;

        for (const input of smInputs) {
          const entry = {
            stateMachine: smName,
            name: input.name,
            type: input.type,
          };
          if ('value' in input) {
            entry.value = input.value;
          }
          inputs.push(entry);
        }
      }
    } catch (e) {
      return { inputs: [], error: e.message };
    }

    return { inputs };
  },

  async rav_set_sm_input({ name, value }) {
    if (!name) throw new Error('name is required');
    const inst = window.riveInst;
    if (!inst) throw new Error('No animation loaded');

    const smNames = Array.isArray(inst.stateMachineNames)
      ? inst.stateMachineNames : [];

    for (const smName of smNames) {
      if (typeof inst.stateMachineInputs !== 'function') continue;
      const smInputs = inst.stateMachineInputs(smName);
      if (!Array.isArray(smInputs)) continue;

      const input = smInputs.find(i => i.name === name);
      if (input) {
        if (value === 'fire' && typeof input.fire === 'function') {
          input.fire();
        } else {
          input.value = value;
        }
        return { ok: true, name, value };
      }
    }
    throw new Error(`Input "${name}" not found in any state machine`);
  },

  async rav_eval({ expression }) {
    assertMcpScriptAccess('rav_eval');
    if (!expression) throw new Error('expression is required');
    try {
      // eslint-disable-next-line no-eval
      const result = await eval(expression);
      if (result === undefined) return { result: 'undefined' };
      if (result === null) return { result: 'null' };
      try {
        return { result: JSON.parse(JSON.stringify(result)) };
      } catch {
        return { result: String(result) };
      }
    } catch (e) {
      throw new Error(`Eval error: ${e.message}`);
    }
  },

  async rav_console_open() {
    if (typeof window._mcpConsoleOpen !== 'function') throw new Error('Console not available');
    return window._mcpConsoleOpen();
  },

  async rav_console_close() {
    if (typeof window._mcpConsoleClose !== 'function') throw new Error('Console not available');
    return window._mcpConsoleClose();
  },

  async rav_console_read({ limit = 50 } = {}) {
    if (typeof window._mcpConsoleRead !== 'function') throw new Error('Console not available');
    return window._mcpConsoleRead(limit);
  },

  async rav_console_exec({ code }) {
    assertMcpScriptAccess('rav_console_exec');
    if (!code) throw new Error('code is required');
    if (typeof window._mcpConsoleExec !== 'function') throw new Error('Console not available');
    return window._mcpConsoleExec(code);
  },
};

// ---------------------------------------------------------------------------
// Formatted event logging helpers
// ---------------------------------------------------------------------------

function mcpLog(type, message, payload) {
  if (typeof window._mcpLogEvent === 'function') {
    window._mcpLogEvent(type, message, payload);
  }
}

function updateStatusIndicator(state) {
  if (typeof window._mcpUpdateStatus === 'function') {
    window._mcpUpdateStatus(state);
  }
}

/**
 * Format a command and its params into a human-readable summary for the
 * event console — avoids dumping raw JSON.
 */
function formatCommandSummary(command, params) {
  const label = command.replace(/^rav_/, '').replace(/_/g, ' ');
  if (!params || Object.keys(params).length === 0) return label;

  const parts = Object.entries(params).map(([key, val]) => {
    if (typeof val === 'string' && val.length > 60) {
      return `${key}: "${val.slice(0, 57)}..."`;
    }
    if (typeof val === 'string') return `${key}: "${val}"`;
    return `${key}: ${JSON.stringify(val)}`;
  });
  return `${label}  ${parts.join(', ')}`;
}

/**
 * Format a result into a compact human-readable summary.
 */
function formatResultSummary(command, result) {
  if (!result || typeof result !== 'object') return String(result ?? 'ok');

  // Status
  if (command === 'rav_status') {
    const file = result.file?.name || 'none';
    const rt = result.runtime?.name || '?';
    const ver = result.runtime?.version || '?';
    const playing = result.playback?.isPlaying ? 'playing' : 'paused';
    const vm = result.viewModel?.pathCount || 0;
    return `${file} | ${rt} ${ver} | ${playing} | ${vm} VM paths`;
  }

  // VM tree
  if (command === 'rav_get_vm_tree') {
    const paths = result.paths?.length || 0;
    const inputs = result.inputs?.length || 0;
    return `${paths} paths, ${inputs} inputs`;
  }

  // VM get
  if (command === 'rav_vm_get') {
    return `${result.path} = ${JSON.stringify(result.value)}`;
  }

  // VM set
  if (command === 'rav_vm_set') {
    return `${result.path} \u2190 ${JSON.stringify(result.value)}`;
  }

  // Open file
  if (command === 'rav_open_file' && result.file) {
    const size = result.sizeBytes ? ` (${(result.sizeBytes / 1024).toFixed(1)} KB)` : '';
    return `Opened ${result.file}${size}`;
  }

  // Event log
  if (command === 'rav_get_event_log') {
    return `${result.returned}/${result.total} events`;
  }

  // SM inputs
  if (command === 'rav_get_sm_inputs') {
    return `${result.inputs?.length || 0} inputs`;
  }

  // Artboards / state machines
  if (result.artboards) return result.artboards.join(', ') || 'none';
  if (result.stateMachines) return result.stateMachines.join(', ') || 'none';

  // Editor code
  if (command === 'rav_get_editor_code' && result.code !== undefined) {
    const lines = result.code.split('\n').length;
    return `${lines} lines`;
  }

  // Generic ok
  if (result.ok) return 'ok';

  // Eval
  if (command === 'rav_eval' && result.result !== undefined) {
    const s = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
    return s.length > 80 ? s.slice(0, 77) + '...' : s;
  }

  return 'ok';
}

// ---------------------------------------------------------------------------
// WebSocket connection management
// ---------------------------------------------------------------------------

/** Report current state to the UI indicator. */
function syncState() {
  if (!enabled) {
    updateStatusIndicator('off');
  } else if (connected) {
    updateStatusIndicator('connected');
  } else {
    updateStatusIndicator('waiting');
  }
}

function clearConnectTimeout() {
  if (!connectTimeoutTimer) return;
  clearTimeout(connectTimeoutTimer);
  connectTimeoutTimer = null;
}

function armConnectTimeout(socket) {
  clearConnectTimeout();
  connectTimeoutTimer = setTimeout(() => {
    if (ws !== socket) return;
    if (!socket || socket.readyState !== WebSocket.CONNECTING) return;
    try {
      socket.close();
    } catch {
      ws = null;
    }
  }, CONNECT_TIMEOUT_MS);
}

async function connect() {
  if (!enabled) return;
  if (connectPromise) {
    return connectPromise;
  }
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  connectPromise = (async () => {
    await syncBridgePortFromDesktop();
    if (!enabled) return;
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return;
    }

    connectionAttempts++;
    syncState(); // show "waiting"

    let socket;
    try {
      socket = new WebSocket(getBridgeUrl());
      ws = socket;
      connectStartedAt = Date.now();
      armConnectTimeout(socket);
    } catch {
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      if (ws !== socket) {
        try {
          socket.close();
        } catch {
          /* noop */
        }
        return;
      }
      try {
        socket.send(JSON.stringify({ bridgeHello: 'rav-app' }));
      } catch (error) {
        console.warn('[rav-mcp-bridge] Failed to send bridge handshake', error);
        socket.close();
        return;
      }
      connected = true;
      reconnectDelay = RECONNECT_DELAY_MS;
      clearConnectTimeout();
      syncState();
      mcpLog('connected', `Bridge connected to MCP server on port ${bridgePort}`);
      console.log(`[rav-mcp-bridge] Connected to MCP server at ${getBridgeUrl()}`);
    };

    socket.onmessage = async (event) => {
      if (ws !== socket) {
        return;
      }

      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        console.warn('[rav-mcp-bridge] Invalid JSON from MCP server');
        return;
      }

      const { id, command, params } = msg;
      if (!id || !command) return;

      const handler = commandHandlers[command];
      if (!handler) {
        mcpLog('error', `Unknown command: ${command}`);
        socket.send(JSON.stringify({ id, error: `Unknown command: ${command}` }));
        return;
      }

      // Log the incoming command
      mcpLog('recv', formatCommandSummary(command, params));

      const startTime = performance.now();
      try {
        const result = await handler(params || {});
        const elapsed = Math.round(performance.now() - startTime);
        mcpLog('reply', `${command.replace(/^rav_/, '')} \u2192 ${formatResultSummary(command, result)}  (${elapsed}ms)`);
        socket.send(JSON.stringify({ id, result }));
      } catch (error) {
        const elapsed = Math.round(performance.now() - startTime);
        mcpLog('error', `${command.replace(/^rav_/, '')} failed: ${error.message}  (${elapsed}ms)`);
        socket.send(JSON.stringify({ id, error: error.message }));
      }
    };

    socket.onclose = () => {
      if (ws !== socket) {
        return;
      }
      const wasConnected = connected;
      connected = false;
      clearConnectTimeout();
      ws = null;
      syncState();
      if (wasConnected) {
        mcpLog('disconnected', 'Bridge disconnected from MCP server');
        console.log('[rav-mcp-bridge] Disconnected from MCP server');
      }
      scheduleReconnect();
    };

    socket.onerror = () => {
      // onclose will fire after this, handling reconnection
    };
  })();

  try {
    await connectPromise;
  } finally {
    connectPromise = null;
  }
}

function scheduleReconnect() {
  if (!enabled) return;
  if (reconnectTimer) return;
  const delay = Math.max(100, Math.min(reconnectDelay, MAX_RECONNECT_DELAY_MS));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
  reconnectDelay = Math.min(delay * 1.5, MAX_RECONNECT_DELAY_MS);
}

function reconnectNow() {
  if (!enabled || connected) return;
  disconnect();
  reconnectDelay = RECONNECT_DELAY_MS;
  connect();
}

function startWatchdog() {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    if (!enabled || connected) return;

    if (ws && ws.readyState === WebSocket.CONNECTING) {
      if ((Date.now() - connectStartedAt) >= CONNECT_TIMEOUT_MS) {
        try {
          ws.close();
        } catch {
          ws = null;
        }
      }
      return;
    }

    if (!ws && !reconnectTimer) {
      reconnectDelay = RECONNECT_DELAY_MS;
      connect();
    }
  }, WATCHDOG_INTERVAL_MS);
}

// ---------------------------------------------------------------------------
// Public API (for app.js to check status)
// ---------------------------------------------------------------------------

function disconnect() {
  connectPromise = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  clearConnectTimeout();
  if (ws) {
    ws.onclose = null; // prevent reconnect from onclose handler
    ws.close(1000, 'Bridge disabled');
    ws = null;
  }
  connected = false;
}

window._mcpBridge = {
  commands: commandHandlers,
  get connected() { return connected; },
  get enabled() { return enabled; },
  get port() { return bridgePort; },
  get state() { return !enabled ? 'off' : connected ? 'connected' : 'waiting'; },
  get connectionAttempts() { return connectionAttempts; },

  /** Enable the bridge and start connecting. */
  enable() {
    if (enabled) return;
    enabled = true;
    reconnectDelay = RECONNECT_DELAY_MS;
    syncState();
    mcpLog('enabled', 'MCP bridge enabled');
    connect();
  },

  /** Disable the bridge and close any active connection. */
  disable() {
    if (!enabled) return;
    enabled = false;
    disconnect();
    syncState();
    mcpLog('disabled', 'MCP bridge disabled');
    void invokeDesktop('stop_mcp_bridge');
  },

  /** Toggle enabled/disabled. */
  toggle() {
    if (enabled) {
      this.disable();
    } else {
      this.enable();
    }
  },

  /** Force reconnect (resets backoff). */
  reconnect() {
    disconnect();
    reconnectDelay = RECONNECT_DELAY_MS;
    connect();
  },

  setPort(nextPort) {
    const normalizedPort = normalizeBridgePort(nextPort);
    if (normalizedPort === bridgePort) {
      return bridgePort;
    }
    bridgePort = normalizedPort;
    persistBridgePort(bridgePort);
    if (enabled) {
      disconnect();
      reconnectDelay = RECONNECT_DELAY_MS;
      connect();
    } else {
      syncState();
    }
    return bridgePort;
  },
};

window.addEventListener('focus', reconnectNow);
window.addEventListener('pageshow', reconnectNow);
window.addEventListener('online', reconnectNow);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    reconnectNow();
  }
});

// Start connection
syncState();
startWatchdog();
connect();
