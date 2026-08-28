use super::{bundle::default_app_integration_allowed, RivDefaultAppStatus};

#[cfg(target_os = "macos")]
use super::{
    bundle::{
        current_bundle_path, macos_supports_default_application_api, validate_installed_bundle,
    },
    handlers::{query_default_handlers, set_default_handler, status_after_failed_change},
    registration::register_bundle,
    CANONICAL_RIV_UTI, LEGACY_RAV_RIV_UTI,
};

#[cfg(target_os = "macos")]
pub(super) const fn handler_content_types() -> [&'static str; 2] {
    [CANONICAL_RIV_UTI, LEGACY_RAV_RIV_UTI]
}

#[cfg(target_os = "macos")]
pub(super) const DEFAULT_APP_VERIFY_DELAYS_MS: [u64; 8] =
    [0, 100, 200, 400, 800, 1_200, 1_200, 1_200];

pub(super) async fn get_riv_default_app_status(app: tauri::AppHandle) -> RivDefaultAppStatus {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return RivDefaultAppStatus::unavailable("Available on macOS only", None);
    }

    #[cfg(target_os = "macos")]
    {
        let bundle_hint = current_bundle_path();
        if !default_app_integration_allowed(&app.config().identifier) {
            return RivDefaultAppStatus::unavailable(
                "Available in the installed RAV release",
                bundle_hint.as_deref(),
            );
        }
        let bundle = match validate_installed_bundle() {
            Ok(bundle) => bundle,
            Err(reason) => return RivDefaultAppStatus::unavailable(reason, bundle_hint.as_deref()),
        };
        if !macos_supports_default_application_api() {
            return RivDefaultAppStatus::unavailable("Requires macOS 12 or newer", Some(&bundle));
        }

        match query_default_handlers(&app, bundle.clone()).await {
            Ok(status) => status,
            Err(reason) => RivDefaultAppStatus::unavailable(reason, Some(&bundle)),
        }
    }
}

pub(super) async fn make_rav_default_for_riv(app: tauri::AppHandle) -> RivDefaultAppStatus {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return RivDefaultAppStatus::unavailable("Available on macOS only", None);
    }

    #[cfg(target_os = "macos")]
    {
        let bundle_hint = current_bundle_path();
        if !default_app_integration_allowed(&app.config().identifier) {
            return RivDefaultAppStatus::unavailable(
                "Available in the installed RAV release",
                bundle_hint.as_deref(),
            );
        }
        let bundle = match validate_installed_bundle() {
            Ok(bundle) => bundle,
            Err(reason) => return RivDefaultAppStatus::unavailable(reason, bundle_hint.as_deref()),
        };
        if !macos_supports_default_application_api() {
            return RivDefaultAppStatus::unavailable("Requires macOS 12 or newer", Some(&bundle));
        }

        if let Err(reason) = query_default_handlers(&app, bundle.clone()).await {
            return RivDefaultAppStatus::unavailable(reason, Some(&bundle));
        }

        // Use the same complete Launch Services path for both MAKE DEFAULT and
        // REPAIR ICON. Re-registering refreshes the document/icon claims; then
        // reasserting both handlers gives Finder the same association-change
        // notification as the original successful default-app operation.
        if let Err(reason) = register_bundle(&bundle) {
            return status_after_failed_change(&app, bundle, reason).await;
        }
        for type_identifier in handler_content_types() {
            if let Err(reason) = set_default_handler(&app, bundle.clone(), type_identifier).await {
                return status_after_failed_change(&app, bundle, reason).await;
            }
        }

        let mut last_status = None;
        let mut consecutive_confirmations = 0_u8;
        for delay_ms in DEFAULT_APP_VERIFY_DELAYS_MS {
            if delay_ms > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
            }
            match query_default_handlers(&app, bundle.clone()).await {
                Ok(status) if status.state == "rav-default" => {
                    consecutive_confirmations += 1;
                    if consecutive_confirmations >= 2 {
                        return status;
                    }
                    last_status = Some(status);
                }
                Ok(status) => {
                    consecutive_confirmations = 0;
                    last_status = Some(status);
                }
                Err(reason) => return RivDefaultAppStatus::unavailable(reason, Some(&bundle)),
            }
        }

        let mut status = last_status.unwrap_or_else(|| {
            RivDefaultAppStatus::unavailable(
                "macOS did not return a default .riv app status",
                Some(&bundle),
            )
        });
        if status.state != "rav-other-copy" {
            status.state = "pending".into();
            status.reason = Some(format!(
                "macOS accepted the request but has not confirmed this RAV copy for both .riv content types. Canonical: {}; legacy: {}.",
                status.canonical_handler_path.as_deref().unwrap_or("no handler"),
                status.legacy_handler_path.as_deref().unwrap_or("no handler"),
            ));
        }
        status
    }
}
