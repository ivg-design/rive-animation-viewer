use tauri::{
    http::{header, Request, Response, StatusCode},
    Manager, Runtime, UriSchemeContext,
};

use super::{RENDER_SURFACE_DIRECTORY, RENDER_SURFACE_FILE_NAME, RENDER_SURFACE_LABEL};

/// Serves only the generated, cache-local standalone HTML to the child WebView.
/// A registered custom protocol is treated as a local Tauri origin, so the
/// event bridge remains available without granting arbitrary remote IPC.
pub fn serve_render_surface_protocol<R: Runtime>(
    context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if context.webview_label() != RENDER_SURFACE_LABEL
        || request.uri().path() != format!("/{RENDER_SURFACE_FILE_NAME}")
    {
        return protocol_error(StatusCode::NOT_FOUND, "Render surface resource not found");
    }

    let html_path = match context.app_handle().path().app_cache_dir() {
        Ok(cache_dir) => cache_dir
            .join(RENDER_SURFACE_DIRECTORY)
            .join(RENDER_SURFACE_FILE_NAME),
        Err(error) => {
            return protocol_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to resolve RAV cache directory: {error}"),
            )
        }
    };

    match std::fs::read(&html_path) {
        Ok(html) => Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CACHE_CONTROL, "no-store")
            .body(html)
            .expect("valid render surface response"),
        Err(error) => protocol_error(
            StatusCode::NOT_FOUND,
            &format!("Failed to read render surface HTML: {error}"),
        ),
    }
}

fn protocol_error(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(message.as_bytes().to_vec())
        .expect("valid render surface error response")
}
