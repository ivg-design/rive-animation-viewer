use base64::{engine::general_purpose::STANDARD, Engine};
use std::fs;

use crate::app::state::DemoBundlePayload;

const DEMO_TEMPLATE_SHELL: &str = include_str!("../demo-template/shell.html");
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
    include_str!("../demo-template/js/core/layout.js"),
    "\n",
    include_str!("../demo-template/js/core/bootstrap.js"),
    "\n",
    include_str!("../demo-template/js/core/playback-layout.js"),
    "\n",
    include_str!("../demo-template/js/core/settings.js"),
    "\n",
    include_str!("../demo-template/js/core/event-log.js"),
    "\n",
    include_str!("../demo-template/js/vm/accessors.js"),
    "\n",
    include_str!("../demo-template/js/vm/hierarchy.js"),
    "\n",
    include_str!("../demo-template/js/vm/controls-render.js"),
    "\n",
    include_str!("../demo-template/js/vm/sync.js"),
    "\n",
    include_str!("../demo-template/js/core/rive-loader.js"),
);

#[tauri::command]
pub async fn make_demo_bundle(payload: DemoBundlePayload) -> Result<String, String> {
    let suggested = format!(
        "{}-demo.html",
        payload
            .file_name
            .replace(|c: char| !c.is_ascii_alphanumeric(), "-")
    );

    let save_path = rfd::FileDialog::new()
        .set_title("Save Rive Demo Viewer")
        .set_file_name(&suggested)
        .add_filter("HTML File", &["html"])
        .save_file();

    let path = save_path.ok_or_else(|| "Save canceled".to_string())?;

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
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create directory {}: {}", parent.display(), error))?;
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
      "runtimeName": payload.runtime_name,
      "runtimeVersion": payload.runtime_version,
      "animationBase64": payload.animation_base64,
      "autoplay": payload.autoplay,
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
      "layoutState": layout_state
    });
    let config_json = serde_json::to_string(&config)?;
    let escaped_config = escape_embedded_script_json(&config_json);
    let escaped_runtime = payload.runtime_script.replace("</script", "<\\/script");
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
    let vm_hierarchy_json = payload.vm_hierarchy.as_deref().unwrap_or("null").to_string();
    let escaped_vm_hierarchy = escape_embedded_script_json(&vm_hierarchy_json);
    let title = format!("{} – Rive Demo", payload.file_name);

    let html = DEMO_TEMPLATE_SHELL
        .replace("__DEMO_STYLES__", DEMO_TEMPLATE_STYLES)
        .replace("__DEMO_MARKUP__", DEMO_TEMPLATE_MARKUP)
        .replace("__DEMO_APP_JS__", DEMO_TEMPLATE_APP_JS)
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

pub fn escape_embedded_script_json(raw: &str) -> String {
    raw.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace("</script", "<\\/script")
}

#[cfg(test)]
mod tests {
    use super::{build_demo_html, escape_embedded_script_json};
    use crate::app::state::DemoBundlePayload;

    #[test]
    fn escapes_script_closing_sequences_in_embedded_demo_json() {
        let raw = r#"{"instantiationCode":"<script>demo()</script>","vm":"</script>"}"#;
        let escaped = escape_embedded_script_json(raw);

        assert!(!escaped.contains("</script"));
        assert!(escaped.contains("<\\/script"));
    }

    #[test]
    fn demo_html_escapes_instantiation_snippets_before_embedding_config() {
        let payload = DemoBundlePayload {
            animation_base64: "AQID".into(),
            animations: vec![],
            artboard_name: Some("Main".into()),
            autoplay: true,
            canvas_color: Some("#0d1117".into()),
            canvas_sizing: None,
            canvas_transparent: false,
            control_snapshot: Some(r#"[{"descriptor":{"path":"root/value","kind":"number"},"kind":"number","value":42}]"#.into()),
            default_instantiation_package_source: "cdn".into(),
            file_name: "demo.riv".into(),
            instantiation_code: "<canvas></canvas>\n<script type=\"module\">\nconsole.log('ok');\n</script>".into(),
            instantiation_snippets: Some(r#"{"cdn":"<script src=\"https://unpkg.com/demo\"></script>","local":"<script type=\"module\"></script>"}"#.into()),
            instantiation_source_mode: "internal".into(),
            layout_alignment: "center".into(),
            layout_fit: "contain".into(),
            layout_state: Some("{}".into()),
            runtime_name: "webgl2".into(),
            runtime_script: "console.log('runtime');".into(),
            runtime_version: Some("2.36.0".into()),
            state_machines: vec!["main-sm".into()],
            vm_hierarchy: Some(r#"{"label":"root","text":"</script>"}"#.into()),
        };

        let html = build_demo_html(&payload).expect("demo html");

        assert!(html.contains("<\\/script>"));
        assert!(html.contains("const CONFIG = JSON.parse('"));
        assert!(html.contains("const VM_HIERARCHY = JSON.parse('"));
        assert!(html.contains("defaultInstantiationPackageSource"));
        assert!(html.contains("instantiationSnippets"));
        assert!(html.contains("controlSnapshot"));
    }

    #[test]
    fn demo_html_includes_canvas_background_helper_and_copy_button() {
        let payload = DemoBundlePayload {
            animation_base64: "AQID".into(),
            animations: vec!["idle".into()],
            artboard_name: Some("Main".into()),
            autoplay: true,
            canvas_color: Some("#0d1117".into()),
            canvas_sizing: None,
            canvas_transparent: false,
            control_snapshot: None,
            default_instantiation_package_source: "cdn".into(),
            file_name: "demo.riv".into(),
            instantiation_code: "console.log('snippet');".into(),
            instantiation_snippets: Some(r#"{"cdn":"console.log('cdn');","local":"console.log('local');"}"#.into()),
            instantiation_source_mode: "internal".into(),
            layout_alignment: "center".into(),
            layout_fit: "contain".into(),
            layout_state: Some("{}".into()),
            runtime_name: "webgl2".into(),
            runtime_script: "console.log('runtime');".into(),
            runtime_version: Some("2.37.0".into()),
            state_machines: vec!["main-sm".into()],
            vm_hierarchy: None,
        };

        let html = build_demo_html(&payload).expect("demo html");

        assert!(html.contains("function updateCanvasBackground()"));
        assert!(html.contains("id=\"copy-instantiation-btn\""));
        assert!(html.contains("id=\"fullscreen-toggle-btn\""));
        assert!(html.contains("id=\"event-log-toggle-btn\""));
        assert!(html.contains("copy web instantiation code"));
        assert!(!html.contains("id=\"show-event-log-btn\""));
        assert!(!html.contains("fullscreen-exit-hint"));
    }
}
