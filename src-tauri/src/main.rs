// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use std::fs;
use tauri::{CustomMenuItem, Menu, MenuItem, Submenu};

#[derive(Deserialize)]
struct DemoBundlePayload {
    file_name: String,
    animation_base64: String,
    runtime_name: String,
    runtime_version: Option<String>,
    runtime_script: String,
    autoplay: bool,
    layout_fit: String,
    state_machines: Vec<String>,
    artboard_name: Option<String>,
    canvas_color: Option<String>,
}

#[cfg(debug_assertions)]
#[tauri::command]
fn open_devtools(window: tauri::Window) {
    // DevTools are only available in debug builds
    window.open_devtools();
}

#[cfg(not(debug_assertions))]
#[tauri::command]
fn open_devtools(_window: tauri::Window) {
    // In release builds, this is a no-op
    println!("DevTools are only available in debug builds");
}

#[tauri::command]
async fn make_demo_bundle(payload: DemoBundlePayload) -> Result<String, String> {
    let suggested = format!(
        "{}-demo.html",
        payload
            .file_name
            .replace(|c: char| !c.is_ascii_alphanumeric(), "-")
    );

    let save_path = tauri::api::dialog::blocking::FileDialogBuilder::new()
        .set_title("Save Rive Demo Viewer")
        .set_file_name(&suggested)
        .add_filter("HTML File", &["html"])
        .save_file();

    let path = match save_path {
        Some(path) => path,
        None => return Err("Save canceled".into()),
    };

    let html = build_demo_html(&payload).map_err(|error| error.to_string())?;
    fs::write(&path, html).map_err(|error| error.to_string())?;

    Ok(path.to_string_lossy().to_string())
}

fn build_demo_html(payload: &DemoBundlePayload) -> Result<String, serde_json::Error> {
    use serde_json::json;

    let config = json!({
      "runtimeName": payload.runtime_name,
      "runtimeVersion": payload.runtime_version,
      "animationBase64": payload.animation_base64,
      "autoplay": payload.autoplay,
      "layoutFit": payload.layout_fit,
      "stateMachines": payload.state_machines,
      "artboardName": payload.artboard_name,
      "canvasColor": payload
        .canvas_color
        .clone()
        .unwrap_or_else(|| "#0d1117".into())
    });
    let config_json = serde_json::to_string(&config)?;
    let escaped_runtime = payload.runtime_script.replace("</script", "<\\/script");

    let html = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Rive Demo Viewer</title>
  <style>
    :root {{
      color-scheme: dark;
    }}
    *, *::before, *::after {{
      box-sizing: border-box;
    }}
    body {{
      margin: 0;
      min-height: 100vh;
      background: #050608;
      color: #c9d1d9;
      font-family: "Monaco","Menlo","Ubuntu Mono",monospace;
      display: flex;
      flex-direction: column;
    }}
    main {{
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 20px;
      gap: 12px;
    }}
    #rive-canvas {{
      width: 100%;
      flex: 1;
      border: 1px solid #30363d;
      border-radius: 8px;
      background: var(--canvas-color, #0d1117);
      display: block;
    }}
    .controls {{
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    }}
    button {{
      padding: 8px 18px;
      border-radius: 6px;
      border: 1px solid #30363d;
      background: #21262d;
      color: inherit;
      font-weight: 600;
      cursor: pointer;
    }}
    button:hover {{
      background: #30363d;
    }}
    label {{
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 8px;
    }}
    input[type="color"] {{
      width: 48px;
      height: 48px;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 0;
      background: transparent;
      cursor: pointer;
    }}
    .vm-controls-panel {{
      border: 1px solid #30363d;
      border-radius: 8px;
      background: #0d1117;
      overflow: hidden;
    }}
    .vm-controls-panel > summary {{
      padding: 10px 12px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      text-transform: uppercase;
      font-size: 12px;
      color: #8b949e;
      letter-spacing: 0.35px;
      user-select: none;
      list-style: none;
    }}
    .vm-controls-panel > summary::-webkit-details-marker {{
      display: none;
    }}
    .vm-controls-count {{
      min-width: 22px;
      height: 22px;
      padding: 0 6px;
      border-radius: 999px;
      background: rgba(56, 139, 253, 0.16);
      border: 1px solid rgba(56, 139, 253, 0.45);
      color: #58a6ff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
    }}
    .vm-controls-content {{
      border-top: 1px solid #30363d;
      max-height: 220px;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }}
    .vm-controls-empty {{
      font-size: 12px;
      color: #6e7681;
    }}
    .vm-controls-tree {{
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 0;
    }}
    .vm-node {{
      border: 1px solid #30363d;
      border-radius: 6px;
      background: #161b22;
      overflow: hidden;
    }}
    .vm-node > summary {{
      list-style: none;
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      color: #c9d1d9;
      font-size: 12px;
    }}
    .vm-node > summary::-webkit-details-marker {{
      display: none;
    }}
    .vm-node-meta {{
      color: #8b949e;
      font-size: 11px;
    }}
    .vm-node-body {{
      border-top: 1px solid #30363d;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }}
    .vm-input-list {{
      display: grid;
      gap: 8px;
    }}
    .vm-child-nodes {{
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-left: 8px;
      padding-left: 8px;
      border-left: 1px dashed rgba(139, 148, 158, 0.35);
    }}
    .vm-control-row {{
      border: 1px solid #30363d;
      border-radius: 6px;
      background: #161b22;
      padding: 8px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(120px, 46%);
      gap: 10px;
      align-items: center;
    }}
    .vm-control-path {{
      font-size: 11px;
      color: #8b949e;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }}
    .vm-control-input input[type="text"],
    .vm-control-input input[type="number"],
    .vm-control-input select {{
      width: 100%;
      min-width: 0;
      height: 34px;
      border-radius: 6px;
      border: 1px solid #30363d;
      background: #0d1117;
      color: #c9d1d9;
      padding: 0 8px;
      font: inherit;
      font-size: 13px;
    }}
    .vm-control-input input[type="checkbox"] {{
      width: 18px;
      height: 18px;
    }}
    .vm-control-input button {{
      width: 100%;
      height: 34px;
      font-size: 12px;
      padding: 0 8px;
    }}
    .vm-color-control {{
      display: grid;
      grid-template-columns: minmax(0, 1fr) 56px;
      gap: 6px;
      align-items: center;
    }}
    .vm-color-control input[type="color"] {{
      width: 100%;
      min-width: 0;
      height: 34px;
      border: 1px solid #30363d;
      border-radius: 6px;
      background: #0d1117;
      padding: 0;
    }}
    .vm-color-control input[type="number"] {{
      width: 56px;
      padding: 0 6px;
    }}
    footer {{
      padding: 12px 20px;
      font-size: 12px;
      color: #8b949e;
      border-top: 1px solid #30363d;
    }}
    /* Fullscreen mode styles */
    body.fullscreen-mode main {{
      padding: 0;
      gap: 0;
    }}
    body.fullscreen-mode #rive-canvas {{
      border: none;
      border-radius: 0;
    }}
    body.fullscreen-mode .controls,
    body.fullscreen-mode .vm-controls-panel,
    body.fullscreen-mode footer {{
      display: none;
    }}
    /* Hover trigger for bottom-right corner */
    #fullscreen-trigger {{
      position: fixed;
      bottom: 0;
      right: 0;
      width: 120px;
      height: 120px;
      display: none;
      pointer-events: all;
      z-index: 10;
    }}
    body.fullscreen-mode #fullscreen-trigger {{
      display: block;
    }}
    /* Expand icon */
    #expand-icon {{
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 48px;
      height: 48px;
      background: #21262d;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 12px;
      cursor: pointer;
      opacity: 0;
      transform: scale(0.8);
      transition: opacity 0.2s ease, transform 0.2s ease;
      pointer-events: none;
      z-index: 11;
    }}
    #expand-icon.visible {{
      opacity: 1;
      transform: scale(1);
      pointer-events: all;
    }}
    #expand-icon:hover {{
      background: #30363d;
      transform: scale(1.05);
    }}
    #expand-icon svg {{
      width: 100%;
      height: 100%;
      display: block;
    }}
    @media (max-width: 720px) {{
      .vm-control-row {{
        grid-template-columns: 1fr;
      }}
      .vm-controls-content {{
        max-height: 180px;
      }}
    }}
  </style>
</head>
<body>
  <main>
    <canvas id="rive-canvas"></canvas>
    <div class="controls">
      <button id="play-btn">Play</button>
      <button id="pause-btn">Pause</button>
      <button id="fullscreen-btn">Fullscreen</button>
      <label>Canvas color<input type="color" id="bg-color-input" value="{canvas_color}"></label>
    </div>
    <details class="vm-controls-panel" id="vm-controls-panel" open>
      <summary>
        VM Inputs
        <span class="vm-controls-count" id="vm-controls-count">0</span>
      </summary>
      <div class="vm-controls-content">
        <p class="vm-controls-empty" id="vm-controls-empty">No bound ViewModel inputs detected.</p>
        <div class="vm-controls-tree" id="vm-controls-tree"></div>
      </div>
    </details>
  </main>
  <footer>© 2025 IVG Design · MIT License · Rive runtime © Rive</footer>
  <div id="fullscreen-trigger"></div>
  <div id="expand-icon">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <rect width="256" height="256" fill="none"/>
      <polyline points="160 80 192 80 192 112" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
      <polyline points="96 176 64 176 64 144" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
      <rect x="32" y="48" width="192" height="160" rx="8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/>
    </svg>
  </div>
  <script>window.__DEMO_CONFIG__ = {config_json};</script>
  <script>{escaped_runtime}</script>
  <script>
    (function() {{
      const config = window.__DEMO_CONFIG__;
      const canvas = document.getElementById('rive-canvas');
      const layout = new window.rive.Layout({{ fit: config.layoutFit || 'contain', alignment: 'center' }});
      const vmPanel = document.getElementById('vm-controls-panel');
      const vmCount = document.getElementById('vm-controls-count');
      const vmEmpty = document.getElementById('vm-controls-empty');
      const vmTree = document.getElementById('vm-controls-tree');

      function applyCanvasColor(color) {{
        document.documentElement.style.setProperty('--canvas-color', color);
      }}

      const colorInput = document.getElementById('bg-color-input');
      const startColor = config.canvasColor || '#0d1117';
      colorInput.value = startColor;
      applyCanvasColor(startColor);
      colorInput.addEventListener('input', (event) => {{
        applyCanvasColor(event.target.value);
      }});

      function base64ToUrl(base64) {{
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {{
          bytes[i] = binary.charCodeAt(i);
        }}
        const blob = new Blob([bytes], {{ type: 'application/octet-stream' }});
        return URL.createObjectURL(blob);
      }}

      function normalizeStateMachines(value) {{
        if (Array.isArray(value)) {{
          return value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0);
        }}
        if (typeof value === 'string' && value.trim().length > 0) {{
          return [value];
        }}
        return [];
      }}

      function resetVmControls(message) {{
        if (!vmPanel || !vmCount || !vmEmpty || !vmTree) {{
          return;
        }}
        vmTree.innerHTML = '';
        vmCount.textContent = '0';
        vmEmpty.hidden = false;
        vmEmpty.textContent = message || 'No bound ViewModel inputs detected.';
      }}

      function resolveVmRootInstance() {{
        if (!riveInstance) {{
          return null;
        }}
        if (riveInstance.viewModelInstance) {{
          return riveInstance.viewModelInstance;
        }}
        try {{
          const defaultViewModel = typeof riveInstance.defaultViewModel === 'function'
            ? riveInstance.defaultViewModel()
            : null;
          if (!defaultViewModel) {{
            return null;
          }}
          if (typeof defaultViewModel.defaultInstance === 'function') {{
            return defaultViewModel.defaultInstance();
          }}
          if (typeof defaultViewModel.instance === 'function') {{
            return defaultViewModel.instance();
          }}
        }} catch (_error) {{
          return null;
        }}
        return null;
      }}

      function safeVmCall(target, methodName, arg) {{
        if (!target || typeof target[methodName] !== 'function') {{
          return null;
        }}
        try {{
          return target[methodName](arg) || null;
        }} catch (_error) {{
          return null;
        }}
      }}

      function getVmAccessor(rootVm, path) {{
        const probes = [
          ['number', 'number'],
          ['boolean', 'boolean'],
          ['string', 'string'],
          ['enum', 'enum'],
          ['color', 'color'],
          ['trigger', 'trigger'],
        ];

        for (const [kind, methodName] of probes) {{
          const accessor = safeVmCall(rootVm, methodName, path);
          if (accessor) {{
            return {{ kind, accessor }};
          }}
        }}
        return null;
      }}

      function getListLength(listAccessor) {{
        if (!listAccessor) {{
          return 0;
        }}
        if (typeof listAccessor.length === 'number') {{
          return Math.max(0, Math.floor(listAccessor.length));
        }}
        if (typeof listAccessor.size === 'number') {{
          return Math.max(0, Math.floor(listAccessor.size));
        }}
        return 0;
      }}

      function getVmListItemAt(listAccessor, index) {{
        if (!listAccessor || typeof listAccessor.instanceAt !== 'function') {{
          return null;
        }}
        try {{
          return listAccessor.instanceAt(index);
        }} catch (_error) {{
          return null;
        }}
      }}

      function buildVmHierarchy(rootVm) {{
        const seenInputPaths = new Set();
        const activeInstances = new WeakSet();
        let totalInputs = 0;

        const walk = (instance, label, basePath, kind = 'vm') => {{
          const node = {{
            label,
            path: basePath || '<root>',
            kind,
            inputs: [],
            children: [],
          }};
          if (!instance || typeof instance !== 'object') {{
            return node;
          }}
          if (activeInstances.has(instance)) {{
            return node;
          }}
          activeInstances.add(instance);

          const properties = Array.isArray(instance.properties) ? instance.properties : [];
          properties.forEach((property) => {{
            const name = property?.name;
            if (typeof name !== 'string' || !name) {{
              return;
            }}
            const fullPath = basePath ? `${{basePath}}/${{name}}` : name;
            const accessorInfo = getVmAccessor(rootVm, fullPath);
            if (accessorInfo && !seenInputPaths.has(fullPath)) {{
              node.inputs.push({{
                name,
                path: fullPath,
                kind: accessorInfo.kind,
              }});
              seenInputPaths.add(fullPath);
              totalInputs += 1;
            }}

            const nestedVm = safeVmCall(instance, 'viewModelInstance', name) || safeVmCall(instance, 'viewModel', name);
            if (nestedVm && nestedVm !== instance) {{
              node.children.push(walk(nestedVm, name, fullPath, 'vm'));
            }}

            const listAccessor = safeVmCall(instance, 'list', name);
            const listLength = getListLength(listAccessor);
            if (listLength > 0) {{
              const listNode = {{
                label: `${{name}} [${{listLength}}]`,
                path: fullPath,
                kind: 'list',
                inputs: [],
                children: [],
              }};
              for (let index = 0; index < listLength; index += 1) {{
                const itemInstance = getVmListItemAt(listAccessor, index);
                if (!itemInstance) {{
                  continue;
                }}
                const itemPath = `${{fullPath}}/${{index}}`;
                listNode.children.push(walk(itemInstance, `Instance ${{index}}`, itemPath, 'instance'));
              }}
              node.children.push(listNode);
            }}
          }});

          activeInstances.delete(instance);
          return node;
        }};

        const rootNode = walk(rootVm, 'Root VM', '', 'vm');
        rootNode.totalInputs = totalInputs;
        return rootNode;
      }}

      function clamp(value, min, max) {{
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {{
          return min;
        }}
        return Math.min(max, Math.max(min, numeric));
      }}

      function toHexByte(value) {{
        return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
      }}

      function argbToColorMeta(value) {{
        const raw = Number.isFinite(Number(value)) ? Number(value) >>> 0 : 0xff000000;
        const alpha = (raw >>> 24) & 255;
        const red = (raw >>> 16) & 255;
        const green = (raw >>> 8) & 255;
        const blue = raw & 255;
        return {{
          hex: `#${{toHexByte(red)}}${{toHexByte(green)}}${{toHexByte(blue)}}`,
          alphaPercent: Math.round((alpha / 255) * 100),
        }};
      }}

      function hexToRgb(hex) {{
        const cleanHex = String(hex || '').replace('#', '');
        if (!/^[0-9a-fA-F]{{6}}$/.test(cleanHex)) {{
          return {{ r: 0, g: 0, b: 0 }};
        }}
        return {{
          r: parseInt(cleanHex.slice(0, 2), 16),
          g: parseInt(cleanHex.slice(2, 4), 16),
          b: parseInt(cleanHex.slice(4, 6), 16),
        }};
      }}

      function rgbAlphaToArgb(red, green, blue, alpha) {{
        return (
          ((clamp(alpha, 0, 255) & 255) << 24)
          | ((clamp(red, 0, 255) & 255) << 16)
          | ((clamp(green, 0, 255) & 255) << 8)
          | (clamp(blue, 0, 255) & 255)
        ) >>> 0;
      }}

      function resolveLiveAccessor(path, expectedKind) {{
        const rootVm = resolveVmRootInstance();
        if (!rootVm) {{
          return null;
        }}
        const accessorInfo = getVmAccessor(rootVm, path);
        if (!accessorInfo) {{
          return null;
        }}
        if (expectedKind && accessorInfo.kind !== expectedKind) {{
          return null;
        }}
        return accessorInfo.accessor;
      }}

      function createVmControlRow(descriptor) {{
        const row = document.createElement('div');
        row.className = 'vm-control-row';

        const pathEl = document.createElement('div');
        pathEl.className = 'vm-control-path';
        pathEl.textContent = `${{descriptor.name || descriptor.path}} (${{descriptor.kind}})`;
        pathEl.title = descriptor.path;

        const inputWrap = document.createElement('div');
        inputWrap.className = 'vm-control-input';
        const accessor = resolveLiveAccessor(descriptor.path, descriptor.kind);
        const disabled = !accessor;

        if (descriptor.kind === 'number') {{
          const input = document.createElement('input');
          input.type = 'number';
          input.step = 'any';
          input.value = Number.isFinite(accessor?.value) ? String(accessor.value) : '0';
          input.disabled = disabled;
          input.addEventListener('change', () => {{
            const nextValue = Number(input.value);
            if (!Number.isFinite(nextValue)) {{
              return;
            }}
            const live = resolveLiveAccessor(descriptor.path, 'number');
            if (live) {{
              live.value = nextValue;
            }}
          }});
          inputWrap.appendChild(input);
        }} else if (descriptor.kind === 'boolean') {{
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.checked = Boolean(accessor?.value);
          input.disabled = disabled;
          input.addEventListener('change', () => {{
            const live = resolveLiveAccessor(descriptor.path, 'boolean');
            if (live) {{
              live.value = input.checked;
            }}
          }});
          inputWrap.appendChild(input);
        }} else if (descriptor.kind === 'string') {{
          const input = document.createElement('input');
          input.type = 'text';
          input.value = typeof accessor?.value === 'string' ? accessor.value : '';
          input.disabled = disabled;
          input.addEventListener('change', () => {{
            const live = resolveLiveAccessor(descriptor.path, 'string');
            if (live) {{
              live.value = input.value;
            }}
          }});
          inputWrap.appendChild(input);
        }} else if (descriptor.kind === 'enum') {{
          const select = document.createElement('select');
          const values = Array.isArray(accessor?.values) ? accessor.values : [];
          values.forEach((value) => {{
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            select.appendChild(option);
          }});
          if (!values.length) {{
            const option = document.createElement('option');
            option.value = '';
            option.textContent = '(no enum values)';
            select.appendChild(option);
          }}
          if (typeof accessor?.value === 'string') {{
            select.value = accessor.value;
          }}
          select.disabled = disabled || values.length === 0;
          select.addEventListener('change', () => {{
            const live = resolveLiveAccessor(descriptor.path, 'enum');
            if (live) {{
              live.value = select.value;
            }}
          }});
          inputWrap.appendChild(select);
        }} else if (descriptor.kind === 'color') {{
          const colorWrap = document.createElement('div');
          colorWrap.className = 'vm-color-control';
          const colorInput = document.createElement('input');
          const alphaInput = document.createElement('input');
          colorInput.type = 'color';
          alphaInput.type = 'number';
          alphaInput.min = '0';
          alphaInput.max = '100';
          alphaInput.step = '1';

          const meta = argbToColorMeta(accessor?.value);
          colorInput.value = meta.hex;
          alphaInput.value = String(meta.alphaPercent);
          colorInput.disabled = disabled;
          alphaInput.disabled = disabled;

          const applyColor = () => {{
            const live = resolveLiveAccessor(descriptor.path, 'color');
            if (!live) {{
              return;
            }}
            const rgb = hexToRgb(colorInput.value);
            const alphaPercent = clamp(alphaInput.value, 0, 100);
            alphaInput.value = String(Math.round(alphaPercent));
            const alpha = Math.round((alphaPercent / 100) * 255);
            if (typeof live.argb === 'function') {{
              live.argb(alpha, rgb.r, rgb.g, rgb.b);
              return;
            }}
            live.value = rgbAlphaToArgb(rgb.r, rgb.g, rgb.b, alpha);
          }};

          colorInput.addEventListener('input', applyColor);
          alphaInput.addEventListener('change', applyColor);

          colorWrap.appendChild(colorInput);
          colorWrap.appendChild(alphaInput);
          inputWrap.appendChild(colorWrap);
        }} else if (descriptor.kind === 'trigger') {{
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = 'Fire';
          button.disabled = disabled;
          button.addEventListener('click', () => {{
            const live = resolveLiveAccessor(descriptor.path, 'trigger');
            if (!live) {{
              return;
            }}
            if (typeof live.trigger === 'function') {{
              live.trigger();
              return;
            }}
            if (typeof live.fire === 'function') {{
              live.fire();
            }}
          }});
          inputWrap.appendChild(button);
        }}

        row.appendChild(pathEl);
        row.appendChild(inputWrap);
        return row;
      }}

      function createVmNodeElement(node, isRoot = false) {{
        const details = document.createElement('details');
        details.className = 'vm-node';
        details.open = isRoot;

        const summary = document.createElement('summary');
        summary.textContent = node.label;

        const meta = document.createElement('span');
        meta.className = 'vm-node-meta';
        meta.textContent = `${{node.inputs.length}} inputs`;
        summary.appendChild(meta);
        details.appendChild(summary);

        const body = document.createElement('div');
        body.className = 'vm-node-body';

        if (node.inputs.length) {{
          const inputList = document.createElement('div');
          inputList.className = 'vm-input-list';
          node.inputs.forEach((input) => {{
            inputList.appendChild(createVmControlRow(input));
          }});
          body.appendChild(inputList);
        }}

        if (node.children.length) {{
          const childrenContainer = document.createElement('div');
          childrenContainer.className = 'vm-child-nodes';
          node.children.forEach((child) => {{
            childrenContainer.appendChild(createVmNodeElement(child));
          }});
          body.appendChild(childrenContainer);
        }}

        if (!node.inputs.length && !node.children.length) {{
          const empty = document.createElement('p');
          empty.className = 'vm-controls-empty';
          empty.textContent = `No controls in ${{node.label}}.`;
          body.appendChild(empty);
        }}

        details.appendChild(body);
        return details;
      }}

      function renderVmControls() {{
        if (!vmPanel || !vmCount || !vmEmpty || !vmTree) {{
          return;
        }}
        const rootVm = resolveVmRootInstance();
        if (!rootVm) {{
          resetVmControls('No bound ViewModel inputs detected.');
          return;
        }}
        const hierarchy = buildVmHierarchy(rootVm);
        vmTree.innerHTML = '';
        vmCount.textContent = String(hierarchy.totalInputs);
        if (!hierarchy.totalInputs && !hierarchy.children.length) {{
          vmEmpty.hidden = false;
          vmEmpty.textContent = 'No writable ViewModel inputs were found.';
          return;
        }}
        vmEmpty.hidden = true;
        vmTree.appendChild(createVmNodeElement(hierarchy, true));
      }}

      const animationUrl = base64ToUrl(config.animationBase64);
      let riveInstance;

      function resizeCanvas() {{
        const ratio = window.devicePixelRatio || 1;
        canvas.width = canvas.clientWidth * ratio;
        canvas.height = canvas.clientHeight * ratio;
      }}

      function initRive() {{
        if (riveInstance) {{
          riveInstance.cleanup?.();
          riveInstance = null;
        }}
        resetVmControls('Loading ViewModel inputs...');
        const stateMachines = normalizeStateMachines(config.stateMachines);
        riveInstance = new window.rive.Rive({{
          src: animationUrl,
          canvas,
          autoplay: config.autoplay !== false,
          autoBind: true,
          stateMachines,
          artboard: config.artboardName || undefined,
          layout,
          onLoad: () => {{
            resizeCanvas();
            riveInstance?.resizeDrawingSurfaceToCanvas();
            renderVmControls();
          }}
        }});
      }}

      document.getElementById('play-btn').addEventListener('click', () => riveInstance?.play());
      document.getElementById('pause-btn').addEventListener('click', () => riveInstance?.pause());

      // Fullscreen functionality
      let hoverTimeout = null;
      const fullscreenBtn = document.getElementById('fullscreen-btn');
      const fullscreenTrigger = document.getElementById('fullscreen-trigger');
      const expandIcon = document.getElementById('expand-icon');

      function enterFullscreenMode() {{
        document.body.classList.add('fullscreen-mode');
      }}

      function exitFullscreenMode() {{
        document.body.classList.remove('fullscreen-mode');
        expandIcon.classList.remove('visible');
        if (hoverTimeout) {{
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }}
      }}

      fullscreenBtn.addEventListener('click', enterFullscreenMode);

      fullscreenTrigger.addEventListener('mouseenter', () => {{
        if (hoverTimeout) {{
          clearTimeout(hoverTimeout);
        }}
        hoverTimeout = setTimeout(() => {{
          expandIcon.classList.add('visible');
        }}, 1000);
      }});

      fullscreenTrigger.addEventListener('mouseleave', () => {{
        if (hoverTimeout) {{
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }}
        // Only hide if not hovering over the icon itself
        setTimeout(() => {{
          if (!expandIcon.matches(':hover')) {{
            expandIcon.classList.remove('visible');
          }}
        }}, 50);
      }});

      // Keep icon visible when hovering over it
      expandIcon.addEventListener('mouseenter', () => {{
        if (hoverTimeout) {{
          clearTimeout(hoverTimeout);
          hoverTimeout = null;
        }}
      }});

      // Hide icon when leaving it (and not over trigger area)
      expandIcon.addEventListener('mouseleave', () => {{
        setTimeout(() => {{
          if (!fullscreenTrigger.matches(':hover')) {{
            expandIcon.classList.remove('visible');
          }}
        }}, 50);
      }});

      expandIcon.addEventListener('click', exitFullscreenMode);

      window.addEventListener('resize', () => {{
        resizeCanvas();
        riveInstance?.resizeDrawingSurfaceToCanvas();
      }});

      resetVmControls('No animation loaded.');
      initRive();
    }})();
  </script>
</body>
</html>"#,
        canvas_color = config["canvasColor"].as_str().unwrap_or("#0d1117")
    );

    Ok(html)
}

fn build_menu(about_item: &CustomMenuItem) -> Menu {
    let app_menu = Submenu::new(
        "Rive Animation Viewer",
        Menu::new()
            .add_item(about_item.clone())
            .add_native_item(MenuItem::Separator)
            .add_native_item(MenuItem::Services)
            .add_native_item(MenuItem::Separator)
            .add_native_item(MenuItem::Hide)
            .add_native_item(MenuItem::HideOthers)
            .add_native_item(MenuItem::ShowAll)
            .add_native_item(MenuItem::Separator)
            .add_native_item(MenuItem::Quit),
    );

    let edit_menu = Submenu::new(
        "Edit",
        Menu::new()
            .add_native_item(MenuItem::Undo)
            .add_native_item(MenuItem::Redo)
            .add_native_item(MenuItem::Separator)
            .add_native_item(MenuItem::Cut)
            .add_native_item(MenuItem::Copy)
            .add_native_item(MenuItem::Paste)
            .add_native_item(MenuItem::SelectAll),
    );

    let view_menu = Submenu::new(
        "View",
        Menu::new().add_native_item(MenuItem::EnterFullScreen),
    );

    let window_menu = Submenu::new(
        "Window",
        Menu::new()
            .add_native_item(MenuItem::Minimize)
            .add_native_item(MenuItem::Zoom)
            .add_native_item(MenuItem::Separator)
            .add_native_item(MenuItem::CloseWindow),
    );

    Menu::new()
        .add_submenu(app_menu)
        .add_submenu(edit_menu)
        .add_submenu(view_menu)
        .add_submenu(window_menu)
}

fn main() {
    let about_item = CustomMenuItem::new("about_ivg", "About Rive Animation Viewer");

    tauri::Builder::default()
        .menu(build_menu(&about_item))
        .on_menu_event(move |event| {
            if event.menu_item_id() == "about_ivg" {
                let message = format!(
          "Rive Animation Viewer v{}\n© 2025 IVG Design · MIT License\nRive runtime © Rive",
          env!("CARGO_PKG_VERSION")
        );
                tauri::api::dialog::message(
                    Some(event.window()),
                    "About Rive Animation Viewer",
                    message,
                );
            }
        })
        .invoke_handler(tauri::generate_handler![make_demo_bundle, open_devtools])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
