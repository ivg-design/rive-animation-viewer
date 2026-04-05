use std::time::Duration;

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
struct ProbeResult {
  before: bool,
  after_minimize: bool,
  after_restore: bool,
}

#[tauri::command]
async fn rust_probe_minimize(window: tauri::WebviewWindow) -> Result<ProbeResult, String> {
  let before = window.is_minimized().map_err(|error| error.to_string())?;
  window.minimize().map_err(|error| error.to_string())?;
  tokio::time::sleep(Duration::from_millis(360)).await;
  let after_minimize = window.is_minimized().map_err(|error| error.to_string())?;
  if after_minimize {
    window.unminimize().map_err(|error| error.to_string())?;
    tokio::time::sleep(Duration::from_millis(220)).await;
  }
  let after_restore = window.is_minimized().map_err(|error| error.to_string())?;
  Ok(ProbeResult {
    before,
    after_minimize,
    after_restore,
  })
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![rust_probe_minimize])
    .setup(|app| {
      let window = app
        .get_webview_window("main")
        .ok_or_else(|| tauri::Error::AssetNotFound("main window missing".into()))?;
      window.show()?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("failed to run window chrome lab");
}
