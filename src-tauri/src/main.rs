// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Deserialize;
use std::fs;

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
    body {{
      background: #0d1117;
      color: #c9d1d9;
      font-family: 'Monaco','Menlo','Ubuntu Mono',monospace;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 20px;
    }}
    #rive-canvas {{
      width: 80vw;
      max-width: 900px;
      height: 60vh;
      background: #111;
      border: 1px solid #30363d;
      border-radius: 8px;
    }}
    .controls {{
      margin-top: 16px;
      display: flex;
      gap: 12px;
    }}
    button {{
      padding: 8px 20px;
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
    footer {{
      margin-top: 20px;
      font-size: 12px;
      color: #8b949e;
    }}
  </style>
</head>
<body>
  <canvas id="rive-canvas" width="800" height="600"></canvas>
  <div class="controls">
    <button id="play-btn">Play</button>
    <button id="pause-btn">Pause</button>
    <button id="reset-btn">Reset</button>
  </div>
  <footer>
    © 2025 IVG Design · MIT License · Rive runtime © Rive
  </footer>
  <script>window.__DEMO_CONFIG__ = {config_json};</script>
  <script>{escaped_runtime}</script>
  <script>
    (function() {{
      const config = window.__DEMO_CONFIG__;
      const canvas = document.getElementById('rive-canvas');
      const layout = new window.rive.Layout({{ fit: config.layoutFit || 'contain', alignment: 'center' }});

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

      function initRive() {{
        if (riveInstance) {{
          riveInstance.cleanup?.();
          riveInstance = null;
        }}
        riveInstance = new window.rive.Rive({{
          src: animationUrl,
          canvas,
          autoplay: config.autoplay !== false,
          stateMachines: config.stateMachines || [],
          layout,
          onLoad: () => riveInstance?.resizeDrawingSurfaceToCanvas()
        }});
      }}

      document.getElementById('play-btn').addEventListener('click', () => riveInstance?.play());
      document.getElementById('pause-btn').addEventListener('click', () => riveInstance?.pause());
      document.getElementById('reset-btn').addEventListener('click', () => riveInstance?.reset());

      window.addEventListener('resize', () => {{
        riveInstance?.resizeDrawingSurfaceToCanvas();
      }});

      initRive();
    }})();
  </script>
</body>
</html>"#
    );

    Ok(html)
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![make_demo_bundle])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
