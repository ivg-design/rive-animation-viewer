use std::path::Path;

use super::{
    app_bundle_path_from_executable, bundle::default_app_integration_allowed, registration_needed,
    startup_registration_allowed,
};

#[test]
fn explicit_default_app_action_is_available_in_production_and_the_isolated_dev_bundle_only() {
    assert!(default_app_integration_allowed("app.rive.animation.viewer"));
    assert!(default_app_integration_allowed(
        "app.rive.animation.viewer.flicker-test"
    ));
    assert!(!default_app_integration_allowed(
        "app.rive.animation.viewer.preview"
    ));
}

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
fn refreshes_for_missing_stale_or_relocated_markers_only() {
    let installed = Path::new("/Applications/Rive Animation Viewer.app");

    assert!(registration_needed(None, "2.5.2", installed));
    assert!(registration_needed(
        Some("2.5.1:riv-uti-v4:/Applications/Rive Animation Viewer.app\n"),
        "2.5.2",
        installed,
    ));
    assert!(registration_needed(
        Some("2.5.2:riv-uti-v2:/Applications/Rive Animation Viewer.app\n"),
        "2.5.2",
        installed,
    ));
    assert!(registration_needed(
        Some("2.5.2:riv-uti-v4:/tmp/Rive Animation Viewer.app\n"),
        "2.5.2",
        installed,
    ));
    assert!(!registration_needed(
        Some("2.5.2:riv-uti-v4:/Applications/Rive Animation Viewer.app\n"),
        "2.5.2",
        installed,
    ));
}

#[test]
fn startup_refresh_is_wired_only_for_normal_official_production_launches() {
    assert!(startup_registration_allowed(
        "app.rive.animation.viewer",
        false,
        false,
    ));
    assert!(!startup_registration_allowed(
        "app.rive.animation.viewer",
        true,
        false,
    ));
    assert!(!startup_registration_allowed(
        "app.rive.animation.viewer",
        false,
        true,
    ));

    // The isolated manual association-test opt-in is intentionally not an
    // input to this startup gate and therefore cannot enable auto-registration.
    assert!(!startup_registration_allowed(
        "app.rive.animation.viewer.flicker-test",
        false,
        false,
    ));
}

#[cfg(target_os = "macos")]
#[test]
fn split_handlers_display_the_canonical_app_name() {
    let status = super::handlers::status_from_handlers(
        Path::new("/Applications/RAV 2.5.4 DEV.app"),
        super::handlers::HandlerSnapshot {
            resolved_content_type: Some(super::RIVIEW_RIV_UTI.into()),
            handlers: vec![
                (
                    super::RIVIEW_RIV_UTI.into(),
                    Some("/Applications/Rive.app".into()),
                ),
                (
                    super::CANONICAL_RIV_UTI.into(),
                    Some("/Applications/Rive.app".into()),
                ),
                (
                    super::LEGACY_RAV_RIV_UTI.into(),
                    Some("/Applications/RAV 2.5.4 DEV.app".into()),
                ),
            ],
        },
    );

    assert_eq!(status.state, "other-app");
    assert_eq!(status.handler_name.as_deref(), Some("Rive"));
}

#[cfg(target_os = "macos")]
struct TemporaryAppBundle {
    bundle: std::path::PathBuf,
    root: std::path::PathBuf,
}

#[cfg(target_os = "macos")]
impl TemporaryAppBundle {
    fn new(file_name: &str, display_name: Option<&str>, bundle_name: &str) -> Self {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should follow the Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "rav-default-handler-name-{}-{unique}",
            std::process::id()
        ));
        let bundle = root.join(file_name);
        std::fs::create_dir_all(bundle.join("Contents"))
            .expect("temporary app bundle should be created");
        let display_name_entry = display_name
            .map(|name| format!("<key>CFBundleDisplayName</key><string>{name}</string>"))
            .unwrap_or_default();
        std::fs::write(
            bundle.join("Contents/Info.plist"),
            format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>test.rav.handler-name</string>
{display_name_entry}
<key>CFBundleName</key><string>{bundle_name}</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>"#
            ),
        )
        .expect("temporary Info.plist should be written");
        Self { bundle, root }
    }
}

#[cfg(target_os = "macos")]
impl Drop for TemporaryAppBundle {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

#[cfg(target_os = "macos")]
#[test]
fn handler_name_uses_bundle_metadata_before_the_app_filename() {
    let app = TemporaryAppBundle::new(
        "Misleading Filename.app",
        Some("Actual Display Name"),
        "Fallback Bundle Name",
    );
    assert_eq!(
        super::handlers::handler_display_name(&app.bundle).as_deref(),
        Some("Actual Display Name")
    );

    let name_only = TemporaryAppBundle::new("Renamed.app", None, "Actual Bundle Name");
    assert_eq!(
        super::handlers::handler_display_name(&name_only.bundle).as_deref(),
        Some("Actual Bundle Name")
    );
}

#[cfg(target_os = "macos")]
#[test]
fn handler_status_canonicalizes_the_current_bundle_symmetrically() {
    use std::os::unix::fs::symlink;

    let app = TemporaryAppBundle::new("RAV Target.app", Some("RAV Target"), "RAV Target");
    let link = app.root.join("RAV Linked.app");
    symlink(&app.bundle, &link).expect("temporary app symlink should be created");
    let status = super::handlers::status_from_handlers(
        &link,
        super::handlers::HandlerSnapshot {
            resolved_content_type: Some(super::CANONICAL_RIV_UTI.into()),
            handlers: super::KNOWN_RIV_UTIS
                .into_iter()
                .map(|identifier| (identifier.into(), Some(app.bundle.clone())))
                .collect(),
        },
    );
    assert_eq!(status.state, "rav-default");
    assert_eq!(status.handler_name.as_deref(), Some("RAV"));
    let canonical_bundle = std::fs::canonicalize(&app.bundle)
        .expect("temporary app bundle should have a canonical path");
    assert_eq!(
        status.current_bundle_path.as_deref(),
        Some(canonical_bundle.to_string_lossy().as_ref())
    );
}

#[cfg(target_os = "macos")]
#[test]
fn handler_status_identifies_another_installed_copy_of_the_same_rav_bundle() {
    let current = TemporaryAppBundle::new("RAV Current.app", Some("RAV"), "RAV");
    let other = TemporaryAppBundle::new("RAV Previous.app", Some("RAV"), "RAV");
    let status = super::handlers::status_from_handlers(
        &current.bundle,
        super::handlers::HandlerSnapshot {
            resolved_content_type: Some(super::RIVIEW_RIV_UTI.into()),
            handlers: super::KNOWN_RIV_UTIS
                .into_iter()
                .map(|identifier| (identifier.into(), Some(other.bundle.clone())))
                .collect(),
        },
    );

    assert_eq!(status.state, "rav-other-copy");
    assert_eq!(status.handler_name.as_deref(), Some("Another RAV copy"));
    assert!(status
        .reason
        .as_deref()
        .is_some_and(|reason| reason.contains(other.bundle.to_string_lossy().as_ref())));
}

#[cfg(target_os = "macos")]
#[test]
fn handler_status_leaves_the_name_empty_only_when_the_primary_app_is_unresolvable() {
    let status = super::handlers::status_from_handlers(
        Path::new("/Applications/RAV.app"),
        super::handlers::HandlerSnapshot {
            resolved_content_type: Some(super::RIVIEW_RIV_UTI.into()),
            handlers: vec![
                (super::RIVIEW_RIV_UTI.into(), Some("/".into())),
                (super::CANONICAL_RIV_UTI.into(), Some("/".into())),
                (super::PLAY_RIV_UTI.into(), Some("/".into())),
                (
                    super::LEGACY_RAV_RIV_UTI.into(),
                    Some("/Applications/Legacy Handler.app".into()),
                ),
            ],
        },
    );
    assert_eq!(status.state, "other-app");
    assert_eq!(status.handler_name, None);
}

#[cfg(target_os = "macos")]
#[test]
fn repair_command_matches_the_2_4_3_registration_contract() {
    let command = super::registration::lsregister_command(Path::new("/Applications/RAV Test.app"));
    assert_eq!(
        command.get_program(),
        std::ffi::OsStr::new(super::registration::LSREGISTER_PATH)
    );
    assert_eq!(
        command.get_args().collect::<Vec<_>>(),
        vec![
            std::ffi::OsStr::new("-f"),
            std::ffi::OsStr::new("/Applications/RAV Test.app")
        ]
    );
}

#[cfg(target_os = "macos")]
#[test]
fn one_click_targets_the_effective_resolved_riv_type() {
    let current_bundle = Path::new("/Applications/RAV Dynamic.app");
    let other_bundle = Path::new("/Applications/Other Viewer.app");
    let status = super::handlers::status_from_handlers(
        current_bundle,
        super::handlers::HandlerSnapshot {
            resolved_content_type: Some("test.vendor.resolved.riv".into()),
            handlers: vec![
                (
                    "test.vendor.resolved.riv".into(),
                    Some(other_bundle.to_path_buf()),
                ),
                (
                    "test.vendor.alias.riv".into(),
                    Some(current_bundle.to_path_buf()),
                ),
            ],
        },
    );

    assert_eq!(
        super::commands::claim_target_content_type(&status, &status),
        "test.vendor.resolved.riv"
    );
}

#[cfg(target_os = "macos")]
#[test]
fn dynamic_riv_handler_collection_has_no_fixed_identifier_limit() {
    let discovered = (0..30)
        .map(|index| format!("test.vendor.{index}.riv"))
        .collect::<Vec<_>>();
    let current_bundle = Path::new("/Applications/RAV Dynamic.app");
    let status = super::handlers::status_from_handlers(
        current_bundle,
        super::handlers::HandlerSnapshot {
            resolved_content_type: Some(discovered[0].clone()),
            handlers: discovered
                .iter()
                .map(|identifier| (identifier.clone(), Some(current_bundle.to_path_buf())))
                .collect(),
        },
    );
    assert_eq!(status.state, "rav-default");
    assert_eq!(status.content_type_handlers.len(), discovered.len());
    assert!(discovered.iter().all(|identifier| status
        .content_type_handlers
        .iter()
        .any(|entry| &entry.content_type == identifier)));
}

#[cfg(target_os = "macos")]
#[test]
fn dynamic_aliases_are_diagnostics_instead_of_click_through_tasks() {
    let current_bundle = Path::new("/Applications/RAV Dynamic.app");
    let other_bundle = Path::new("/Applications/Other Viewer.app");
    let content_types = (0..30)
        .map(|index| format!("test.vendor.{index}.riv"))
        .collect::<Vec<_>>();
    let status = super::handlers::status_from_handlers(
        current_bundle,
        super::handlers::HandlerSnapshot {
            resolved_content_type: Some(content_types[0].clone()),
            handlers: content_types
                .iter()
                .enumerate()
                .map(|(index, identifier)| {
                    let handler = if index == 0 {
                        current_bundle.to_path_buf()
                    } else {
                        other_bundle.to_path_buf()
                    };
                    (identifier.clone(), Some(handler))
                })
                .collect(),
        },
    );

    assert_eq!(status.state, "rav-default");
    assert_eq!(status.content_type_handlers.len(), 30);
    assert_eq!(status.reason, None);
}

#[cfg(target_os = "macos")]
#[test]
fn default_app_verification_allows_launch_services_to_converge() {
    let delays = super::commands::DEFAULT_APP_VERIFY_DELAYS_MS;
    assert_eq!(delays[0], 0);
    assert!(delays.iter().sum::<u64>() >= 5_000);
    assert!(delays.windows(2).take(5).all(|pair| pair[0] <= pair[1]));
}

#[cfg(target_os = "macos")]
#[test]
fn registration_exit_status_is_reported_without_side_effects() {
    assert!(super::registration::registration_exit_result(true, "exit status: 0").is_ok());
    assert_eq!(
        super::registration::registration_exit_result(false, "exit status: 1").unwrap_err(),
        "Launch Services registration exited with status exit status: 1"
    );
}
