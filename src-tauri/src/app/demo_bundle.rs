use base64::{engine::general_purpose::STANDARD, Engine};
use rfd::AsyncFileDialog;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{State, Window};

use crate::app::state::{DemoBundlePayload, NativeDialogState};
const DEMO_TEMPLATE_SHELL: &str = include_str!("../demo-template/shell.html");
const LUCIDE_SCRIPT: &str = include_str!("../../../vendor/lucide.min.js");
const DEMO_TEMPLATE_MARKUP: &str = include_str!("../demo-template/markup.html");
const DEMO_TEMPLATE_STYLES: &str = concat!(
    include_str!("../demo-template/css/base.css"),
    "\n",
    include_str!("../demo-template/css/controls.css"),
    "\n",
    include_str!("../demo-template/css/runtime-layout.css"),
    "\n",
    include_str!("../demo-template/css/event-log.css"),
    "\n",
    include_str!("../demo-template/css/properties.css"),
    "\n",
    include_str!("../demo-template/css/overlays.css"),
);
const DEMO_TEMPLATE_APP_JS: &str = concat!(
    include_str!("../demo-template/js/core/preamble.js"),
    "\n",
    include_str!("../../../src/app/snippets/source/rive-runtime-compatibility.js"),
    "\n",
    include_str!("../demo-template/js/core/color-utils.js"),
    "\n",
    include_str!("../demo-template/js/core/layout.js"),
    "\n",
    include_str!("../demo-template/js/vm/image/load-diagnostics.js"),
    "\n",
    include_str!("../demo-template/js/core/render-surface-bridge.js"),
    "\n",
    include_str!("../demo-template/js/core/bridge/eval.js"),
    "\n",
    include_str!("../demo-template/js/media/interaction-schedule.js"),
    include_str!("../demo-template/js/media/frame-clock.js"),
    include_str!("../demo-template/js/media/recording-clock.js"),
    include_str!("../demo-template/js/media/diagnostic-capture.js"),
    include_str!("../demo-template/js/media/stream/elementary.js"),
    include_str!("../demo-template/js/media/stream/transport.js"),
    include_str!("../demo-template/js/media/stream/video.js"),
    include_str!("../demo-template/js/media/png-encoder.js"),
    include_str!("../demo-template/js/media/capture.js"),
    include_str!("../demo-template/js/media/recording.js"),
    include_str!("../demo-template/js/core/bootstrap.js"),
    "\n",
    include_str!("../demo-template/js/core/playback-layout.js"),
    "\n",
    include_str!("../demo-template/js/core/settings.js"),
    "\n",
    include_str!("../demo-template/js/core/event-log.js"),
    "\n",
    include_str!("../demo-template/js/core/editor-config.js"),
    "\n",
    include_str!("../demo-template/js/vm/accessors.js"),
    "\n",
    include_str!("../demo-template/js/vm/reset-contract.js"),
    "\n",
    include_str!("../demo-template/js/vm/image/validation.js"),
    "\n",
    include_str!("../demo-template/js/vm/image-reset.js"),
    "\n",
    include_str!("../demo-template/js/vm/hierarchy.js"),
    "\n",
    include_str!("../demo-template/js/vm/topology-watch.js"),
    "\n",
    include_str!("../demo-template/js/vm/timeline-state.js"),
    "\n",
    include_str!("../demo-template/js/vm/canonical-state.js"),
    "\n",
    include_str!("../demo-template/js/vm/canonical-publication.js"),
    "\n",
    include_str!("../demo-template/js/vm/controls-render.js"),
    "\n",
    include_str!("../demo-template/js/vm/sync.js"),
    "\n",
    include_str!("../demo-template/js/core/load/first-frame.js"),
    "\n",
    include_str!("../demo-template/js/core/rive-loader.js"),
);
#[tauri::command]
pub async fn make_demo_bundle(
    payload: DemoBundlePayload,
    window: Window,
    dialog_state: State<'_, NativeDialogState>,
) -> Result<String, String> {
    let suggested = format!(
        "{}-demo.html",
        payload
            .file_name
            .replace(|c: char| !c.is_ascii_alphanumeric(), "-")
    );
    let _lease = dialog_state.try_acquire()?;
    let save_handle = AsyncFileDialog::new()
        .set_title("Save Rive Demo Viewer")
        .set_file_name(&suggested)
        .add_filter("HTML File", &["html"])
        .set_parent(&window)
        .save_file()
        .await;
    let path = save_handle
        .map(|handle| handle.path().to_path_buf())
        .ok_or_else(|| "Save canceled".to_string())?;
    let html = build_demo_html(&payload).map_err(|error| error.to_string())?;
    fs::write(&path, html).map_err(|error| error.to_string())?;

    Ok(path.to_string_lossy().to_string())
}
#[tauri::command]
pub async fn make_demo_bundle_to_path(
    payload: DemoBundlePayload,
    output_path: String,
) -> Result<String, String> {
    if output_path.trim().is_empty() {
        return Err("output_path is empty".into());
    }
    let path = std::path::PathBuf::from(&output_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!("Failed to create directory {}: {}", parent.display(), error)
        })?;
    }
    let html = build_demo_html(&payload).map_err(|error| error.to_string())?;
    fs::write(&path, html).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

pub fn build_demo_html(payload: &DemoBundlePayload) -> Result<String, serde_json::Error> {
    use serde_json::json;

    let layout_state = payload
        .layout_state
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .unwrap_or_else(|| json!({}));

    let config = json!({
      "fileName": payload.file_name,
      "runtimeName": payload.runtime_name,
      "runtimeVersion": payload.runtime_version,
      "animationBase64": payload.animation_base64,
      "autoplay": payload.autoplay,
      "controlSelectionKeys": payload
        .control_selection_keys
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .unwrap_or(serde_json::Value::Null),
      "inspectionMetadata": payload.inspection_metadata.as_deref().and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok()),
      "controlSnapshot": payload
        .control_snapshot
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .unwrap_or_else(|| json!([])),
      "defaultInstantiationPackageSource": if payload.default_instantiation_package_source.trim().eq_ignore_ascii_case("local") {
        "local"
      } else {
        "cdn"
      },
      "editorCode": payload.editor_code,
      "instantiationCode": payload.instantiation_code,
      "instantiationSnippets": payload
        .instantiation_snippets
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .unwrap_or_else(|| json!({})),
      "instantiationSourceMode": payload.instantiation_source_mode,
      "layoutAlignment": payload.layout_alignment,
      "layoutFit": payload.layout_fit,
      "stateMachines": payload.state_machines,
      "animations": payload.animations,
      "artboardName": payload.artboard_name,
      "canvasColor": payload
        .canvas_color
        .clone()
        .unwrap_or_else(|| "#0d1117".into()),
      "canvasSizing": payload
        .canvas_sizing
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
        .unwrap_or_else(|| json!({
            "mode": "auto",
            "width": 1280,
            "height": 720,
            "lockAspectRatio": false,
            "aspectRatio": 1280.0 / 720.0
        })),
      "canvasTransparent": payload.canvas_transparent,
      "layoutState": layout_state,
      "viewModelInstanceName": payload.view_model_instance_name
    });
    let config_json = serde_json::to_string(&config)?;
    let escaped_config = escape_embedded_script_json(&config_json);
    let escaped_runtime = escape_script_end_tags(&payload.runtime_script);
    let escaped_lucide = escape_script_end_tags(LUCIDE_SCRIPT);
    let canvas_color = payload.canvas_color.as_deref().unwrap_or("#0d1117");
    let runtime_display = if payload.runtime_name == "canvas" {
        "Canvas"
    } else {
        "WebGL"
    };
    let runtime_version = payload.runtime_version.as_deref().unwrap_or("unknown");
    let app_icon_data_url = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(include_bytes!("../../icons/128x128.png"))
    );
    let vm_hierarchy_json = payload
        .vm_hierarchy
        .as_deref()
        .unwrap_or("null")
        .to_string();
    let escaped_vm_hierarchy = escape_embedded_script_json(&vm_hierarchy_json);
    let title = format!("{} – Rive Demo", payload.file_name);

    let html = DEMO_TEMPLATE_SHELL
        .replace("__DEMO_STYLES__", DEMO_TEMPLATE_STYLES)
        .replace("__DEMO_MARKUP__", DEMO_TEMPLATE_MARKUP)
        .replace("__DEMO_APP_JS__", DEMO_TEMPLATE_APP_JS)
        .replace("__LUCIDE_SCRIPT__", &escaped_lucide)
        .replace("__TITLE__", &title)
        .replace("__CANVAS_COLOR__", canvas_color)
        .replace("__CONFIG_JSON__", &escaped_config)
        .replace("__RUNTIME_SCRIPT__", &escaped_runtime)
        .replace("__VM_HIERARCHY_JSON__", &escaped_vm_hierarchy)
        .replace("__FILE_NAME__", &payload.file_name)
        .replace("__RUNTIME_DISPLAY__", runtime_display)
        .replace("__APP_ICON_DATA_URL__", &app_icon_data_url)
        .replace("__RUNTIME_VERSION__", runtime_version);

    Ok(html)
}

pub(crate) fn write_demo_html_atomically(
    payload: &DemoBundlePayload,
    html_path: &Path,
) -> Result<PathBuf, String> {
    let parent = html_path
        .parent()
        .ok_or_else(|| "Demo HTML path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Failed to create demo cache directory {}: {error}",
            parent.display()
        )
    })?;

    let html = build_demo_html(payload).map_err(|error| error.to_string())?;
    let file_name = html_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("current-demo.html");
    let temporary_path = parent.join(format!(".{file_name}.tmp-{}", uuid::Uuid::new_v4()));
    fs::write(&temporary_path, html).map_err(|error| {
        format!(
            "Failed to write demo HTML {}: {error}",
            temporary_path.display()
        )
    })?;
    fs::rename(&temporary_path, html_path).map_err(|error| {
        let _ = fs::remove_file(&temporary_path);
        format!(
            "Failed to finalize demo HTML {}: {error}",
            html_path.display()
        )
    })?;

    Ok(html_path.to_path_buf())
}

pub fn escape_embedded_script_json(raw: &str) -> String {
    escape_script_end_tags(&raw.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn escape_script_end_tags(raw: &str) -> String {
    const SCRIPT_END_PREFIX: &[u8] = b"</script";
    let bytes = raw.as_bytes();
    let mut escaped = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if index + SCRIPT_END_PREFIX.len() <= bytes.len()
            && bytes[index..index + SCRIPT_END_PREFIX.len()].eq_ignore_ascii_case(SCRIPT_END_PREFIX)
        {
            escaped.extend_from_slice(b"<\\/");
            escaped.extend_from_slice(&bytes[index + 2..index + SCRIPT_END_PREFIX.len()]);
            index += SCRIPT_END_PREFIX.len();
        } else {
            escaped.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(escaped).expect("script escaping preserves UTF-8")
}

#[cfg(test)]
#[path = "demo_bundle/tests.rs"]
mod tests;
