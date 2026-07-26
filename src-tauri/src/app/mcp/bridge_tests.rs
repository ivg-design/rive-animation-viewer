use super::resolve_mcp_server_path_from_executable;
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
