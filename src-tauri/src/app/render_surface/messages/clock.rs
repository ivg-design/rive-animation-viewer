use std::time::Duration;
use tauri::{AppHandle, Manager};

use super::super::RenderSurfaceManager;

/// A native wake-up lane for obscured/minimized WKWebViews. The child only
/// advances when its normal RAF has stalled and playback is actually running.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticks = tokio::time::interval(Duration::from_micros(16_667));
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            ticks.tick().await;
            if app.get_window("main").is_none() {
                break;
            }
            let manager = app.state::<RenderSurfaceManager>();
            if let Ok(label) = manager.active_label() {
                if let Some(view) = app.get_webview(&label) {
                    let _ = view.eval("window.__ravNativeFrameTick?.()");
                }
            }
        }
    });
}
