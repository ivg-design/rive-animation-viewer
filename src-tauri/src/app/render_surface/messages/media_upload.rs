//! Binary capture goes straight from the owning render WebView to bounded native
//! disk IO. No base64, host event relay or frame ACK command behind UI work.
use crate::app::render_surface::registry::RenderSurfaceManager;
use crate::app::render_surface::MAIN_WINDOW_LABEL;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    http::{header, Method, Request, Response, StatusCode},
    Emitter, Manager, Runtime,
};

/// Capture receipts reach the host as events so the live frame count is the
/// native accepted count, not a stale poll. Emission is rate limited per job;
/// the final receipt of a job always arrives through the finish path.
pub const MEDIA_CAPTURE_PROGRESS_EVENT: &str = "media-export:capture";
const CAPTURE_PROGRESS_INTERVAL: Duration = Duration::from_millis(150);
static LAST_PROGRESS: Mutex<Option<(String, Instant)>> = Mutex::new(None);

fn should_emit_progress(job: &str) -> bool {
    let Ok(mut last) = LAST_PROGRESS.lock() else {
        return false;
    };
    let due = match last.as_ref() {
        Some((previous, at)) => previous != job || at.elapsed() >= CAPTURE_PROGRESS_INTERVAL,
        None => true,
    };
    if due {
        *last = Some((job.to_owned(), Instant::now()));
    }
    due
}

static WRITING: AtomicBool = AtomicBool::new(false);
struct WritePermit;
impl Drop for WritePermit {
    fn drop(&mut self) {
        WRITING.store(false, Ordering::Release);
    }
}

pub(in crate::app::render_surface) fn serve<R: Runtime>(
    app: tauri::AppHandle<R>,
    label: String,
    request: Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let failure = if request.method() != Method::POST {
        Some((StatusCode::METHOD_NOT_ALLOWED, "POST required"))
    } else if request.body().is_empty() || request.body().len() > 20 * 1024 * 1024 {
        Some((
            StatusCode::PAYLOAD_TOO_LARGE,
            "Capture packet must contain 1 byte through 20 MiB",
        ))
    } else {
        None
    };
    if let Some((status, message)) = failure {
        responder.respond(response(status, message.as_bytes().to_vec()));
        return;
    }
    let Some(session) = app
        .try_state::<RenderSurfaceManager>()
        .and_then(|manager| manager.routable_surface_for_label(&label).ok().flatten())
        .map(|surface| surface.session_id)
    else {
        responder.respond(response(
            StatusCode::FORBIDDEN,
            b"Capture requires its render surface".to_vec(),
        ));
        return;
    };
    let Some((job, index)) = parse_path(request.uri().path()) else {
        responder.respond(response(
            StatusCode::BAD_REQUEST,
            b"Invalid capture packet path".to_vec(),
        ));
        return;
    };
    if WRITING
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_err()
    {
        responder.respond(response(
            StatusCode::TOO_MANY_REQUESTS,
            b"Await the previous capture write".to_vec(),
        ));
        return;
    }
    let permit = WritePermit;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        let authorized = app
            .try_state::<RenderSurfaceManager>()
            .is_some_and(|manager| {
                manager.route_label(Some(&session)).ok().as_deref() == Some(label.as_str())
            });
        let result = if authorized {
            crate::app::media_export::append_capture(&session, &job, index, request.body())
        } else {
            Err("The capture source is no longer active".into())
        };
        if let Ok(receipt) = result.as_ref() {
            if should_emit_progress(&job) {
                // The main window hosts child webviews, so it is not a single
                // WebviewWindow; address the host webview directly.
                if let Some(webview) = app.get_webview(MAIN_WINDOW_LABEL) {
                    // Best-effort progress must not fail an acknowledged write.
                    // The final count is also available from finish/status.
                    let _ = webview.emit(MEDIA_CAPTURE_PROGRESS_EVENT, receipt.clone());
                }
            }
        }
        responder.respond(match result {
            Ok(value) => response(StatusCode::OK, value.to_string().into_bytes()),
            Err(error) => response(StatusCode::BAD_REQUEST, error.into_bytes()),
        });
    });
}
fn parse_path(path: &str) -> Option<(String, u32)> {
    let (job, index) = path.strip_prefix("/__rav-media/")?.split_once('/')?;
    uuid::Uuid::parse_str(job).ok()?;
    if index.is_empty() || !index.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((job.to_owned(), index.parse().ok()?))
}
fn response(status: StatusCode, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CACHE_CONTROL, "no-store")
        .header(
            header::CONTENT_TYPE,
            if status == StatusCode::OK {
                "application/json"
            } else {
                "text/plain"
            },
        )
        .body(body)
        .expect("valid capture response")
}
#[cfg(test)]
mod tests {
    use super::parse_path;
    #[test]
    fn packet_path_is_not_a_filesystem_path() {
        let id = "12345678-1234-4234-8234-123456789012";
        assert_eq!(
            parse_path(&format!("/__rav-media/{id}/42")),
            Some((id.into(), 42))
        );
        for path in [
            "/__rav-media/../../file",
            &format!("/__rav-media/{id}/1/2"),
            &format!("/__rav-media/{id}/-1"),
        ] {
            assert!(parse_path(path).is_none());
        }
    }
}
