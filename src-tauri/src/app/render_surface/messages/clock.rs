use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tokio::sync::Notify;

use super::super::RenderSurfaceManager;

/// A native wake-up lane for obscured/minimized WKWebViews. The child only
/// advances while a native-owned recording is active. Ordinary playback must
/// remain entirely on the WebView's own RAF; the native lane is not a polling
/// fallback for visible playback.
#[derive(Clone)]
pub struct NativeFrameClock {
    enabled: Arc<AtomicBool>,
    wake: Arc<Notify>,
}

impl Default for NativeFrameClock {
    fn default() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(false)),
            wake: Arc::new(Notify::new()),
        }
    }
}

impl NativeFrameClock {
    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Release);
        self.wake.notify_one();
    }

    #[cfg(test)]
    fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }
}

pub fn start(app: AppHandle) {
    let clock = app.state::<NativeFrameClock>().inner().clone();
    tauri::async_runtime::spawn(async move {
        loop {
            // Waiting on Notify, rather than periodically checking a flag,
            // makes the disabled/ordinary-playback path zero wakeups and zero
            // WebView IPC. Recording start/stop are the only wake events.
            clock.wake.notified().await;
            if !clock.enabled.load(Ordering::Acquire) {
                continue;
            }
            let mut ticks = tokio::time::interval(Duration::from_micros(16_667));
            ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            while clock.enabled.load(Ordering::Acquire) {
                tokio::select! {
                    _ = ticks.tick() => {
                        if !clock.enabled.load(Ordering::Acquire) {
                            continue;
                        }
                        if app.get_window("main").is_none() {
                            clock.set_enabled(false);
                            break;
                        }
                        let manager = app.state::<RenderSurfaceManager>();
                        if let Ok(label) = manager.active_label() {
                            if let Some(view) = app.get_webview(&label) {
                                let _ = view.eval("window.__ravNativeFrameTick?.()");
                            }
                        }
                    }
                    _ = clock.wake.notified() => {}
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::NativeFrameClock;

    #[test]
    fn clock_is_disabled_by_default_and_can_be_toggled() {
        let clock = NativeFrameClock::default();
        assert!(!clock.is_enabled());
        clock.set_enabled(true);
        assert!(clock.is_enabled());
        clock.set_enabled(false);
        assert!(!clock.is_enabled());
    }
}
