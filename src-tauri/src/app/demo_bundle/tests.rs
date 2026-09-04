use super::{build_demo_html, escape_embedded_script_json};
use crate::app::state::DemoBundlePayload;

#[test]
fn escapes_script_closing_sequences_in_embedded_demo_json() {
    let raw = r#"{"instantiationCode":"<script>demo()</SCRIPT>","vm":"</ScRiPt>"}"#;
    let escaped = escape_embedded_script_json(raw);

    assert!(!escaped.to_ascii_lowercase().contains("</script"));
    assert!(escaped.contains("<\\/SCRIPT"));
    assert!(escaped.contains("<\\/ScRiPt"));
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
        control_selection_keys: Some(r#"["vm:root/value:number"]"#.into()),
        inspection_metadata: None,
        control_snapshot: Some(r#"[{"descriptor":{"path":"root/value","kind":"number"},"kind":"number","value":42}]"#.into()),
        default_instantiation_package_source: "cdn".into(),
        editor_code: "({ onLoad: () => window.__editorApplied = true })".into(),
        file_name: "demo.riv".into(),
        instantiation_code: "<canvas></canvas>\n<script type=\"module\">\nconsole.log('ok');\n</script>".into(),
        instantiation_snippets: Some(r#"{"cdn":"<script src=\"https://unpkg.com/demo\"></script>","local":"<script type=\"module\"></script>"}"#.into()),
        instantiation_source_mode: "internal".into(),
        layout_alignment: "center".into(),
        layout_fit: "contain".into(),
        layout_state: Some("{}".into()),
        runtime_name: "webgl2".into(),
        runtime_script: "console.log('</ScRiPt>');".into(),
        runtime_version: Some("2.36.0".into()),
        state_machines: vec!["main-sm".into()],
        view_model_instance_name: Some("Preview".into()),
        vm_hierarchy: Some(r#"{"label":"root","text":"</script>"}"#.into()),
    };

    let html = build_demo_html(&payload).expect("demo html");

    assert!(html.contains("<\\/script>"));
    assert!(html.contains("<\\/ScRiPt>"));
    assert!(html.contains("const CONFIG = JSON.parse('"));
    assert!(html.contains("const VM_HIERARCHY = JSON.parse('"));
    assert!(html.contains("defaultInstantiationPackageSource"));
    assert!(html.contains("instantiationSnippets"));
    assert!(html.contains("controlSelectionKeys"));
    assert!(html.contains("controlSnapshot"));
    assert!(html.contains("\"viewModelInstanceName\":\"Preview\""));
    assert!(html.contains("\"editorCode\":\"({ onLoad: () => window.__editorApplied = true })\""));
    assert!(html.contains("function resolveStandaloneEditorConfig"));
    assert!(html.contains("invokeRenderSurfaceAwareEditorCallback("));
    assert!(html.contains("bindViewModelInstanceByKey(riveInstance, requestedVmInstanceKey)"));
    assert!(html.contains("typeof appliedEditorConfig.autoBind === 'boolean'"));
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
        control_selection_keys: None,
        inspection_metadata: None,
        control_snapshot: None,
        default_instantiation_package_source: "cdn".into(),
        editor_code: String::new(),
        file_name: "demo.riv".into(),
        instantiation_code: "console.log('snippet');".into(),
        instantiation_snippets: Some(
            r#"{"cdn":"console.log('cdn');","local":"console.log('local');"}"#.into(),
        ),
        instantiation_source_mode: "internal".into(),
        layout_alignment: "center".into(),
        layout_fit: "contain".into(),
        layout_state: Some("{}".into()),
        runtime_name: "webgl2".into(),
        runtime_script: "console.log('runtime');".into(),
        runtime_version: Some("2.37.0".into()),
        state_machines: vec!["main-sm".into()],
        view_model_instance_name: None,
        vm_hierarchy: None,
    };
    let html = build_demo_html(&payload).expect("demo html");

    assert!(html.contains("function updateCanvasBackground()"));
    assert!(html.contains("\"controlSelectionKeys\":null"));
    assert!(html.contains("id=\"copy-instantiation-btn\""));
    assert!(html.contains("id=\"fullscreen-toggle-btn\""));
    assert!(html.contains("id=\"event-log-toggle-btn\""));
    assert!(html.contains("grid-template-columns: 28px minmax(88px, 96px)"));
    assert!(html.contains("copy web instantiation code"));
    assert!(!html.contains("id=\"show-event-log-btn\""));
    assert!(!html.contains("fullscreen-exit-hint"));
}
