use super::normalize_mcp_port_for_identifier;
use super::resolve_mcp_server_path_from_executable;
use crate::app::constants::{DEFAULT_MCP_PORT, ISOLATED_DEV_MCP_PORT};
use std::path::PathBuf;

#[test]
fn resolves_sidecar_beside_the_running_executable() {
    let executable_path = PathBuf::from("bundle").join("bin").join("app");
    let sidecar_path =
        resolve_mcp_server_path_from_executable(&executable_path, "rav-mcp").unwrap();

    assert_eq!(
        sidecar_path,
        PathBuf::from("bundle").join("bin").join("rav-mcp")
    );
}

#[test]
fn rejects_an_executable_without_a_parent_directory() {
    let executable_path = PathBuf::from(std::path::MAIN_SEPARATOR.to_string());
    let error = resolve_mcp_server_path_from_executable(&executable_path, "rav-mcp").unwrap_err();

    assert!(error.contains("has no parent directory"));
}

#[test]
fn isolated_instances_normalize_saved_production_port_to_isolated_port() {
    assert_eq!(
        normalize_mcp_port_for_identifier("app.rive.animation.viewer.flicker-test", Some(9274)),
        ISOLATED_DEV_MCP_PORT
    );
    assert_eq!(
        normalize_mcp_port_for_identifier("app.rive.animation.viewer.flicker-test", Some(1)),
        ISOLATED_DEV_MCP_PORT
    );
}

#[test]
fn official_instances_keep_configured_port_and_default() {
    assert_eq!(
        normalize_mcp_port_for_identifier("app.rive.animation.viewer", Some(9274)),
        DEFAULT_MCP_PORT
    );
    assert_eq!(
        normalize_mcp_port_for_identifier("app.rive.animation.viewer", None),
        DEFAULT_MCP_PORT
    );
}
