use super::{bundle::default_app_integration_allowed, RivDefaultAppStatus};

#[cfg(target_os = "macos")]
use super::{
    bundle::{
        current_bundle_path, macos_supports_default_application_api, validate_installed_bundle,
    },
    handlers::{query_default_handlers, set_default_handler, status_after_failed_change},
    registration::register_bundle,
    CANONICAL_RIV_UTI,
};

#[cfg(target_os = "macos")]
pub(super) fn claim_target_content_type(
    initial_status: &RivDefaultAppStatus,
    registered_status: &RivDefaultAppStatus,
) -> String {
    registered_status
        .resolved_content_type
        .as_deref()
        .or(initial_status.resolved_content_type.as_deref())
        .or_else(|| {
            registered_status
                .content_type_handlers
                .first()
                .map(|entry| entry.content_type.as_str())
        })
        .or_else(|| {
            initial_status
                .content_type_handlers
                .first()
                .map(|entry| entry.content_type.as_str())
        })
        .unwrap_or(CANONICAL_RIV_UTI)
        .to_string()
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

        let initial_status = match query_default_handlers(&app, bundle.clone()).await {
            Ok(status) => status,
            Err(reason) => return RivDefaultAppStatus::unavailable(reason, Some(&bundle)),
        };

        // Use the same Launch Services registration path for MAKE DEFAULT and
        // REPAIR ICON. Re-registering refreshes the document and icon claims;
        // MAKE DEFAULT then requests the one effective .riv association below.
        if let Err(reason) = register_bundle(&bundle) {
            return status_after_failed_change(&app, bundle, reason).await;
        }
        let registered_status = match query_default_handlers(&app, bundle.clone()).await {
            Ok(status) => status,
            Err(reason) => return RivDefaultAppStatus::unavailable(reason, Some(&bundle)),
        };
        // One Settings action maps to one macOS request for the effective .riv
        // content type. The dynamically discovered aliases remain diagnostic
        // data; they are not exposed as N separate ownership chores.
        let target = (registered_status.state != "rav-default")
            .then(|| claim_target_content_type(&initial_status, &registered_status));
        if let Some(type_identifier) = target.as_ref() {
            if let Err(reason) =
                set_default_handler(&app, bundle.clone(), type_identifier.clone()).await
            {
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
                Ok(status) => {
                    let confirmed = status.state == "rav-default";
                    if !confirmed {
                        consecutive_confirmations = 0;
                        last_status = Some(status);
                        continue;
                    }
                    consecutive_confirmations += 1;
                    if consecutive_confirmations >= 2 {
                        return status;
                    }
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
            status.reason = Some(match target {
                Some(identifier) => format!(
                    "macOS did not confirm this RAV copy as the default app for .riv files after requesting {identifier}."
                ),
                None => "macOS did not confirm the refreshed RAV document registration.".into(),
            });
        }
        status
    }
}
