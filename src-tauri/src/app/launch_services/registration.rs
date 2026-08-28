use std::path::Path;

pub(super) const LSREGISTER_PATH: &str = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

pub(super) fn register_bundle(bundle: &Path) -> Result<(), String> {
    use std::process::Stdio;

    // This intentionally mirrors the proven 2.4.3 repair mechanism. The
    // marker-gated official production startup may use it to refresh metadata;
    // only the explicit Settings action follows it by reasserting handlers.
    let status = lsregister_command(bundle)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("failed to run Launch Services registration: {error}"))?;
    registration_exit_result(status.success(), &status.to_string())
}

pub(super) fn lsregister_command(bundle: &Path) -> std::process::Command {
    let mut command = std::process::Command::new(LSREGISTER_PATH);
    command.arg("-f").arg(bundle);
    command
}

pub(super) fn registration_exit_result(success: bool, status: &str) -> Result<(), String> {
    if success {
        Ok(())
    } else {
        Err(format!(
            "Launch Services registration exited with status {status}"
        ))
    }
}
