use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::process::Child;
use std::sync::Mutex;
use tauri_plugin_updater::Update;

#[derive(Deserialize)]
pub struct DemoBundlePayload {
    pub file_name: String,
    pub animation_base64: String,
    pub runtime_name: String,
    pub runtime_version: Option<String>,
    pub runtime_script: String,
    pub autoplay: bool,
    pub layout_alignment: String,
    pub layout_fit: String,
    pub state_machines: Vec<String>,
    #[serde(default)]
    pub animations: Vec<String>,
    pub artboard_name: Option<String>,
    pub canvas_color: Option<String>,
    #[serde(default)]
    pub canvas_sizing: Option<String>,
    #[serde(default)]
    pub canvas_transparent: bool,
    #[serde(default)]
    pub control_snapshot: Option<String>,
    #[serde(default)]
    pub default_instantiation_package_source: String,
    #[serde(default)]
    pub instantiation_code: String,
    #[serde(default)]
    pub instantiation_snippets: Option<String>,
    #[serde(default)]
    pub instantiation_source_mode: String,
    pub layout_state: Option<String>,
    pub vm_hierarchy: Option<String>,
}

pub struct OpenedFiles(pub Mutex<VecDeque<String>>);

pub struct McpBridgeManager {
    pub child: Mutex<Option<Child>>,
    pub port: Mutex<u16>,
}

impl McpBridgeManager {
    pub fn new(port: u16) -> Self {
        Self {
            child: Mutex::new(None),
            port: Mutex::new(port),
        }
    }
}

#[derive(Default)]
pub struct PendingAppUpdate(pub Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct WindowCursorPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize)]
pub struct NodeRuntimeStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub source: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateStatus {
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub body: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInstallResult {
    pub installed: bool,
    pub version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpClientStatus {
    pub id: String,
    pub label: String,
    pub available: bool,
    pub installed: bool,
    pub configured: bool,
    pub method: String,
    pub cli_path: Option<String>,
    pub config_path: Option<String>,
    pub detail: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSetupStatus {
    pub server_path: String,
    pub port: u16,
    pub targets: Vec<McpClientStatus>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInstallResult {
    pub target: String,
    pub installed: bool,
    pub detail: String,
}
