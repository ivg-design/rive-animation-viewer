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
      const layout = new window.rive.Layout({{ fit: 'contain', alignment: 'center' }});

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
        riveInstance = new window.rive.Rive({{
          src: animationUrl,
          canvas,
          autoplay: config.autoplay !== false,
          autoBind: true,
          stateMachines: config.stateMachines || [],
          artboard: config.artboardName || undefined,
          layout,
          onLoad: () => {{
            resizeCanvas();
            riveInstance?.resizeDrawingSurfaceToCanvas();
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
