//! Native media boundary. Register these eight commands.
mod discovery;
mod encode;
mod gif;
mod init;
mod jobs;
mod process;
mod spool;
mod types;
mod verify;

pub use discovery::{DistributionComponent, DistributionMetadata, EncoderConfig, TrustedBinary};
use jobs::Backend;
use rfd::AsyncFileDialog;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{State, Window};

use crate::app::state::NativeDialogState;
pub use types::{
    AbortRequest, BeginRequest, ChoosePathRequest, FinishRequest, FrameRequest, Job, JobRequest,
};

static CONFIG: Mutex<Option<EncoderConfig>> = Mutex::new(None);
static BACKEND: OnceLock<Arc<Backend>> = OnceLock::new();
static BACKEND_INIT: Mutex<()> = Mutex::new(());
static FRAME_SLOT: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

/// Call once before any command, with release-managed absolute paths and approved SHA-256s.
/// This verifies file identity; it does not establish redistribution/license compliance.
pub fn configure(config: EncoderConfig) -> types::Result<()> {
    let _initializing = BACKEND_INIT.lock().map_err(types::io)?;
    let mut configured = CONFIG.lock().map_err(types::io)?;
    if BACKEND.get().is_some() {
        return Err("Media backend already initialized".into());
    }
    *configured = Some(config);
    Ok(())
}
fn backend() -> types::Result<Arc<Backend>> {
    init::get_or_try_init(&BACKEND, &BACKEND_INIT, || {
        let config = CONFIG.lock().map_err(types::io)?;
        Backend::new(discovery::discover(config.as_ref()))
    })
}
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> types::Result<T> + Send + 'static,
) -> types::Result<T> {
    tokio::task::spawn_blocking(f).await.map_err(types::io)?
}
#[tauri::command]
pub async fn media_export_capabilities() -> types::Result<serde_json::Value> {
    blocking(|| Ok(backend()?.capabilities())).await
}

fn output_path(path: &Path, format: types::Format) -> PathBuf {
    let accepted = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case(format.extension())
                || (format == types::Format::Apng && extension.eq_ignore_ascii_case("png"))
                || (format == types::Format::Jpg && extension.eq_ignore_ascii_case("jpeg"))
        });
    if accepted {
        path.to_path_buf()
    } else {
        path.with_extension(format.extension())
    }
}

async fn choose_output_path(
    request: &ChoosePathRequest,
    window: &Window,
    dialog_state: &NativeDialogState,
) -> types::Result<Option<String>> {
    let _lease = dialog_state.try_acquire()?;
    let suggested =
        types::suggested_output_file_name(request.format, request.suggested_name.as_deref());
    let selected = AsyncFileDialog::new()
        .set_title("Save media")
        .set_file_name(&suggested)
        .add_filter("Media", &[request.format.extension()])
        .set_parent(window)
        .save_file()
        .await;
    selected
        .map(|handle| {
            output_path(handle.path(), request.format)
                .to_str()
                .map(str::to_string)
                .ok_or_else(|| "Output path must be UTF-8".to_string())
        })
        .transpose()
}

#[tauri::command]
pub async fn media_export_choose_path(
    request: ChoosePathRequest,
    window: Window,
    dialog_state: State<'_, NativeDialogState>,
) -> types::Result<Option<String>> {
    choose_output_path(&request, &window, &dialog_state).await
}

#[tauri::command]
pub async fn media_export_begin(
    mut request: BeginRequest,
    window: Window,
    dialog_state: State<'_, NativeDialogState>,
) -> types::Result<Job> {
    request.validate()?;
    if request.output_path.is_none() {
        request.output_path = Some(
            choose_output_path(
                &ChoosePathRequest {
                    format: request.format,
                    suggested_name: None,
                },
                &window,
                &dialog_state,
            )
            .await?
            .ok_or("Save dialog cancelled")?,
        );
    }
    blocking(move || backend()?.begin(request)).await
}
#[tauri::command]
pub async fn media_export_frame(request: FrameRequest) -> types::Result<Job> {
    if request.png_base64.len() as u64 > types::MAX_PNG.div_ceil(3) * 4 {
        return Err("Frame transport limit exceeded".into());
    }
    let permit = FRAME_SLOT
        .try_acquire()
        .map_err(|_| "Frame backpressure: await the previous acknowledgement")?;
    let result = blocking(move || backend()?.frame(request)).await;
    drop(permit);
    result
}
#[tauri::command]
pub async fn media_export_finish(request: FinishRequest) -> types::Result<Job> {
    blocking(move || backend()?.finish(request)).await
}
#[tauri::command]
pub async fn media_export_cancel(request: JobRequest) -> types::Result<Job> {
    blocking(move || backend()?.cancel(&request.job_id)).await
}
#[tauri::command]
pub async fn media_export_abort(request: AbortRequest) -> types::Result<Job> {
    blocking(move || backend()?.abort(request)).await
}
#[tauri::command]
pub async fn media_export_status(request: JobRequest) -> types::Result<Job> {
    blocking(move || backend()?.status(&request.job_id)).await
}

// Called only by the render-label-authorized custom-scheme handler, off the UI thread.
// No new Tauri command or ACL surface. The handler must cap the body before allocation.
pub fn append_capture(
    session_id: &str,
    job_id: &str,
    index: u32,
    bytes: &[u8],
) -> types::Result<serde_json::Value> {
    if bytes.len() as u64 > types::MAX_PNG {
        return Err("Capture chunk exceeds 20 MiB".into());
    }
    let _permit = FRAME_SLOT
        .try_acquire()
        .map_err(|_| "Capture backpressure: await acknowledgement")?;
    serde_json::to_value(backend()?.append(session_id, job_id, index, bytes)?).map_err(types::io)
}
