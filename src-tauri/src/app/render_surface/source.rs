use std::{
    fs,
    io::ErrorKind,
    path::{Component, Path, PathBuf},
};

use serde::Deserialize;
use tauri::{AppHandle, Manager, Url, WebviewUrl};

use crate::app::{demo_bundle::write_demo_html_atomically, state::DemoBundlePayload};

use super::{
    RENDER_SURFACE_DIRECTORY, RENDER_SURFACE_FILE_PREFIX, RENDER_SURFACE_LABEL_PREFIX,
    RENDER_SURFACE_PROTOCOL, RENDER_SURFACE_URL,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRenderSurfaceRequest {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) width: f64,
    pub(super) height: f64,
    pub(super) url: Option<String>,
    pub(super) html_path: Option<String>,
    pub(super) payload: Option<DemoBundlePayload>,
    pub(super) session_id: Option<String>,
}

pub(super) fn resolve_render_surface_url(
    app: &AppHandle,
    url: Option<&str>,
    html_path: Option<&str>,
    payload: Option<&DemoBundlePayload>,
    surface_file_name: &str,
    session_id: Option<&str>,
) -> Result<WebviewUrl, String> {
    let source_count = usize::from(url.is_some())
        + usize::from(html_path.is_some())
        + usize::from(payload.is_some());
    if source_count > 1 {
        return Err("Provide only one of payload, url, or htmlPath".to_string());
    }

    if let Some(payload) = payload {
        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("Failed to resolve RAV cache directory: {error}"))?;
        let html_path = cache_dir
            .join(RENDER_SURFACE_DIRECTORY)
            .join(surface_file_name);
        let html_path = write_demo_html_atomically(payload, &html_path)?;
        debug_assert_eq!(
            html_path.file_name().and_then(|value| value.to_str()),
            Some(surface_file_name)
        );
        return render_surface_protocol_url(surface_file_name, session_id);
    }

    if let Some(html_path) = html_path {
        let cache_dir = app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("Failed to resolve RAV cache directory: {error}"))?;
        let canonical_cache_dir = std::fs::canonicalize(&cache_dir).map_err(|error| {
            format!(
                "Failed to resolve RAV cache directory {}: {error}",
                cache_dir.display()
            )
        })?;
        let canonical_html_path = std::fs::canonicalize(html_path).map_err(|error| {
            format!("Failed to resolve render surface HTML {html_path}: {error}")
        })?;

        if !canonical_html_path.starts_with(&canonical_cache_dir) {
            return Err("Render surface HTML must be inside the RAV app cache".to_string());
        }
        if canonical_html_path
            .extension()
            .and_then(|value| value.to_str())
            != Some("html")
        {
            return Err("Render surface cache file must have an .html extension".to_string());
        }

        return render_surface_file_url(&canonical_html_path, session_id);
    }

    let app_url = url.unwrap_or(RENDER_SURFACE_URL);
    if !is_safe_app_url(app_url) {
        return Err("Render surface url must be a relative app URL".to_string());
    }
    Ok(WebviewUrl::App(app_url.into()))
}

fn render_surface_file_url(
    html_path: &Path,
    session_id: Option<&str>,
) -> Result<WebviewUrl, String> {
    let mut file_url = Url::from_file_path(html_path).map_err(|_| {
        format!(
            "Failed to create render surface file URL for {}",
            html_path.display()
        )
    })?;
    append_render_surface_query(&mut file_url, session_id);
    Ok(WebviewUrl::External(file_url))
}

fn render_surface_protocol_url(
    surface_file_name: &str,
    session_id: Option<&str>,
) -> Result<WebviewUrl, String> {
    let mut url = Url::parse(&format!(
        "{RENDER_SURFACE_PROTOCOL}://localhost/{surface_file_name}"
    ))
    .map_err(|error| format!("Failed to create render surface protocol URL: {error}"))?;
    append_render_surface_query(&mut url, session_id);
    Ok(WebviewUrl::CustomProtocol(url))
}

pub(super) fn normalize_session_id(session_id: Option<&str>) -> Result<String, String> {
    let value = session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "A render surface sessionId is required".to_string())?;
    if value.len() > 128
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("Render surface sessionId contains unsupported characters".to_string());
    }
    Ok(value.to_string())
}

pub(super) fn render_surface_label(session_id: &str) -> String {
    format!("{RENDER_SURFACE_LABEL_PREFIX}{session_id}")
}

pub(super) fn render_surface_file_name(session_id: &str) -> String {
    format!("{RENDER_SURFACE_FILE_PREFIX}{session_id}.html")
}

pub(super) fn render_surface_cache_path(
    cache_dir: &Path,
    session_id: &str,
) -> Result<PathBuf, String> {
    let session_id = normalize_session_id(Some(session_id))?;
    Ok(cache_dir
        .join(RENDER_SURFACE_DIRECTORY)
        .join(render_surface_file_name(&session_id)))
}

/// Removes only cache files generated for a validated render-surface session.
/// Missing files are already clean. No caller can pass an arbitrary path.
pub(super) fn remove_render_surface_cache_file(
    cache_dir: &Path,
    session_id: &str,
) -> Result<(), String> {
    let path = render_surface_cache_path(cache_dir, session_id)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to remove render surface cache HTML {}: {error}",
            path.display()
        )),
    }
}

/// Best-effort startup cleanup for stale generated surfaces. It is deliberately
/// limited to direct, regular `render-surface-<validated session>.html` files
/// under the dedicated app-cache directory. Failed deletes are returned to the
/// manager so a later lifecycle command can retry them.
pub(super) fn cleanup_stale_render_surface_cache(cache_dir: &Path) -> Vec<(String, String)> {
    let surface_dir = cache_dir.join(RENDER_SURFACE_DIRECTORY);
    let entries = match fs::read_dir(&surface_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return Vec::new(),
        Err(error) => {
            return vec![(
                String::new(),
                format!(
                    "Failed to inspect render surface cache directory {}: {error}",
                    surface_dir.display()
                ),
            )]
        }
    };

    let mut failures = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let Some(file_name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let Some(session_id) = session_id_from_render_surface_file_name(&file_name) else {
            continue;
        };
        if let Err(error) = remove_render_surface_cache_file(cache_dir, &session_id) {
            failures.push((session_id, error));
        }
    }
    failures
}

fn session_id_from_render_surface_file_name(file_name: &str) -> Option<String> {
    let session_id = file_name
        .strip_prefix(RENDER_SURFACE_FILE_PREFIX)?
        .strip_suffix(".html")?;
    normalize_session_id(Some(session_id)).ok()
}

fn append_render_surface_query(url: &mut Url, session_id: Option<&str>) {
    let mut query = url.query_pairs_mut();
    query.append_pair("renderSurface", "1");
    if let Some(session_id) = session_id.filter(|value| !value.trim().is_empty()) {
        query.append_pair("renderSession", session_id.trim());
    }
}

#[cfg(test)]
fn navigable_url(webview_url: &WebviewUrl) -> Option<Url> {
    match webview_url {
        WebviewUrl::External(url) | WebviewUrl::CustomProtocol(url) => Some(url.clone()),
        _ => None,
    }
}

fn is_safe_app_url(url: &str) -> bool {
    let path = url.split(['?', '#']).next().unwrap_or_default();
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains("://")
        && Path::new(path)
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::{
        cleanup_stale_render_surface_cache, is_safe_app_url, navigable_url, normalize_session_id,
        remove_render_surface_cache_file, render_surface_cache_path, render_surface_file_name,
        render_surface_protocol_url,
    };

    #[test]
    fn restricts_static_sources_to_relative_app_urls() {
        assert!(is_safe_app_url("render-surface.html"));
        assert!(is_safe_app_url("render-surface.html?renderSurface=1"));
        assert!(is_safe_app_url("assets/render-surface.html"));
        assert!(!is_safe_app_url("https://example.com/render.html"));
        assert!(!is_safe_app_url("/render-surface.html"));
        assert!(!is_safe_app_url("../render-surface.html"));
        assert!(!is_safe_app_url(""));
    }

    #[test]
    fn generated_surface_uses_local_protocol_and_session_query() {
        let file_name = render_surface_file_name("session-12");
        let url =
            render_surface_protocol_url(&file_name, Some("session-12")).expect("protocol URL");
        let url = navigable_url(&url).expect("navigable URL");
        assert_eq!(url.scheme(), "rav-render");
        assert_eq!(url.host_str(), Some("localhost"));
        assert_eq!(url.path(), "/render-surface-session-12.html");
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "renderSurface")
                .unwrap()
                .1,
            "1"
        );
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "renderSession")
                .unwrap()
                .1,
            "session-12"
        );
    }

    #[test]
    fn restricts_session_ids_used_in_native_labels_and_cache_paths() {
        assert_eq!(
            normalize_session_id(Some("abc-123_A")).unwrap(),
            "abc-123_A"
        );
        assert!(normalize_session_id(None).is_err());
        assert!(normalize_session_id(Some("../escape")).is_err());
        assert!(normalize_session_id(Some("session 12")).is_err());
    }

    #[test]
    fn cache_path_is_deterministic_and_confined_to_the_render_surface_directory() {
        let cache_dir = std::env::temp_dir().join("rav-render-surface-cache-path");
        assert_eq!(
            render_surface_cache_path(&cache_dir, "session_1").unwrap(),
            cache_dir.join("render-surface/render-surface-session_1.html")
        );
        assert!(render_surface_cache_path(&cache_dir, "../escape").is_err());
    }

    #[test]
    fn startup_cleanup_removes_only_valid_generated_surface_html() {
        let cache_dir = std::env::temp_dir().join(format!(
            "rav-render-surface-cleanup-{}",
            uuid::Uuid::new_v4()
        ));
        let surface_dir = cache_dir.join("render-surface");
        fs::create_dir_all(&surface_dir).unwrap();
        let generated = surface_dir.join("render-surface-valid-session.html");
        let unrelated = surface_dir.join("other.html");
        let traversal_lookalike = surface_dir.join("render-surface-..escape.html");
        fs::write(&generated, "generated").unwrap();
        fs::write(&unrelated, "keep").unwrap();
        fs::write(&traversal_lookalike, "keep").unwrap();

        assert!(cleanup_stale_render_surface_cache(&cache_dir).is_empty());
        assert!(!generated.exists());
        assert!(unrelated.exists());
        assert!(traversal_lookalike.exists());
        fs::remove_dir_all(cache_dir).unwrap();
    }

    #[test]
    fn failed_cache_delete_returns_an_error_without_widening_the_target() {
        let cache_dir = std::env::temp_dir().join(format!(
            "rav-render-surface-delete-failure-{}",
            uuid::Uuid::new_v4()
        ));
        let target = render_surface_cache_path(&cache_dir, "blocked").unwrap();
        fs::create_dir_all(&target).unwrap();

        let error = remove_render_surface_cache_file(&cache_dir, "blocked").unwrap_err();
        assert!(error.contains("render-surface-blocked.html"));
        assert!(target.is_dir());
        fs::remove_dir_all(cache_dir).unwrap();
    }
}
