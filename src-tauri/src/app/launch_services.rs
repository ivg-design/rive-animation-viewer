use std::path::{Path, PathBuf};

/// Returns the enclosing `.app` bundle for a macOS app executable.
///
/// Development binaries are intentionally rejected: Launch Services should only
/// be refreshed for a shipped bundle whose Info.plist is actually registered.
pub(crate) fn app_bundle_path_from_executable(executable: &Path) -> Option<PathBuf> {
    let macos_dir = executable.parent()?;
    if macos_dir.file_name()?.to_str()? != "MacOS" {
        return None;
    }
    let contents_dir = macos_dir.parent()?;
    if contents_dir.file_name()?.to_str()? != "Contents" {
        return None;
    }
    let bundle = contents_dir.parent()?;
    if bundle.extension()?.to_str()? != "app" {
        return None;
    }
    Some(bundle.to_path_buf())
}

pub(crate) fn registration_needed(
    marker_contents: Option<&str>,
    package_version: &str,
    bundle: &Path,
) -> bool {
    let expected = registration_marker(package_version, bundle);
    marker_contents
        .map(|contents| contents.trim() != expected)
        .unwrap_or(true)
}

const DOCUMENT_TYPE_REGISTRATION_REVISION: &str = "riv-uti-owner-v4";

fn registration_marker(package_version: &str, bundle: &Path) -> String {
    format!(
        "{package_version}:{DOCUMENT_TYPE_REGISTRATION_REVISION}:{}",
        bundle.display()
    )
}

#[cfg(target_os = "macos")]
const LSREGISTER_PATH: &str = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/// Re-register the shipped app bundle once per package version and document
/// type schema revision.
///
/// `lsregister -f` refreshes the bundle's declared document types and imported
/// UTI metadata without changing the bundle's role/rank or restarting Finder.
pub fn refresh_for_installed_version(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        use std::fs;
        use std::process::{Command, Stdio};
        use tauri::Manager;

        let executable = std::env::current_exe()
            .map_err(|error| format!("failed to resolve app executable: {error}"))?;
        let Some(bundle) = app_bundle_path_from_executable(&executable) else {
            // `cargo tauri dev` and test binaries are not installed bundles.
            return Ok(());
        };
        if !bundle.join("Contents").join("Info.plist").is_file() {
            return Ok(());
        }
        let canonical_bundle = fs::canonicalize(&bundle).unwrap_or(bundle);

        let version = app.package_info().version.to_string();
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("failed to resolve app data directory: {error}"))?;
        let marker = data_dir.join("launch-services-registration-version");
        let marker_contents = fs::read_to_string(&marker).ok();
        if !registration_needed(marker_contents.as_deref(), &version, &canonical_bundle) {
            return Ok(());
        }

        let status = Command::new(LSREGISTER_PATH)
            .arg("-f")
            .arg(&canonical_bundle)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|error| format!("failed to run Launch Services registration: {error}"))?;
        if !status.success() {
            return Err(format!(
                "Launch Services registration exited with status {status}"
            ));
        }

        fs::create_dir_all(&data_dir)
            .map_err(|error| format!("failed to create app data directory: {error}"))?;
        let temporary_marker = data_dir.join(format!(
            "launch-services-registration-version.{}.tmp",
            std::process::id()
        ));
        fs::write(
            &temporary_marker,
            format!("{}\n", registration_marker(&version, &canonical_bundle)),
        )
        .map_err(|error| format!("failed to write Launch Services marker: {error}"))?;
        fs::rename(&temporary_marker, &marker)
            .map_err(|error| format!("failed to commit Launch Services marker: {error}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{app_bundle_path_from_executable, registration_needed};
    use std::path::Path;

    #[test]
    fn derives_bundle_only_from_installed_app_executable() {
        assert_eq!(
            app_bundle_path_from_executable(Path::new(
                "/Applications/Rive Animation Viewer.app/Contents/MacOS/Rive Animation Viewer"
            )),
            Some(Path::new("/Applications/Rive Animation Viewer.app").to_path_buf())
        );
        assert_eq!(
            app_bundle_path_from_executable(Path::new("target/debug/app")),
            None
        );
    }

    #[test]
    fn refreshes_when_marker_is_missing_or_for_another_version() {
        let installed = Path::new("/Applications/Rive Animation Viewer.app");
        assert!(registration_needed(None, "2.4.4", installed));
        assert!(registration_needed(Some("2.4.3\n"), "2.4.4", installed));
        assert!(registration_needed(Some("2.4.4\n"), "2.4.4", installed));
        assert!(registration_needed(
            Some("2.4.4:riv-uti-owner-v4:/tmp/Rive Animation Viewer.app\n"),
            "2.4.4",
            installed,
        ));
        assert!(!registration_needed(
            Some("2.4.4:riv-uti-owner-v4:/Applications/Rive Animation Viewer.app\n"),
            "2.4.4",
            installed,
        ));
    }
}
