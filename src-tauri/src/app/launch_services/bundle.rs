use std::path::{Path, PathBuf};

use crate::app::constants::is_official_app_identifier;

use super::app_bundle_path_from_executable;

const ISOLATED_DEFAULT_APP_TEST_IDENTIFIER: &str = "app.rive.animation.viewer.flicker-test";

pub(super) fn default_app_integration_allowed(identifier: &str) -> bool {
    is_official_app_identifier(identifier)
        // The isolated bundle has a deliberately distinct identifier and can
        // only make this change after an explicit Settings action. Keeping the
        // allowance tied to that identifier makes DEV verification reliable
        // without broadening production's automatic registration behavior.
        || identifier == ISOLATED_DEFAULT_APP_TEST_IDENTIFIER
}

#[cfg(target_os = "macos")]
pub(super) fn current_bundle_path() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|executable| app_bundle_path_from_executable(&executable))
        .map(|bundle| std::fs::canonicalize(&bundle).unwrap_or(bundle))
}

#[cfg(target_os = "macos")]
pub(super) fn validate_installed_bundle() -> Result<PathBuf, String> {
    let bundle = current_bundle_path()
        .ok_or_else(|| "RAV must be run from an installed application bundle".to_string())?;
    validate_bundle_location_and_contents(&bundle)?;
    Ok(bundle)
}

#[cfg(target_os = "macos")]
fn validate_bundle_location_and_contents(bundle: &Path) -> Result<(), String> {
    let bundle_text = bundle.to_string_lossy();
    if bundle_text.starts_with("/Volumes/") {
        return Err("Move RAV out of the disk image before making it the default app".into());
    }
    if bundle_text.contains("/AppTranslocation/") {
        return Err("Move RAV to Applications before making it the default app".into());
    }
    if bundle_text.contains("/.Trash/") || bundle_text.ends_with("/.Trash") {
        return Err("Move RAV out of Trash before making it the default app".into());
    }
    if !bundle.join("Contents/Info.plist").is_file() {
        return Err("The RAV application bundle is missing Info.plist".into());
    }
    if !bundle
        .join("Contents/Resources/RiveFileIcon.icns")
        .is_file()
    {
        return Err("The RAV application bundle is missing its .riv file icon".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub(super) fn macos_supports_default_application_api() -> bool {
    use objc2_foundation::NSProcessInfo;

    NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion
        >= 12
}
