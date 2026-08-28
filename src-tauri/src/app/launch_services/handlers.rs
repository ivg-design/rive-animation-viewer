use std::path::{Path, PathBuf};

use super::{path_string, RivDefaultAppStatus, CANONICAL_RIV_UTI, LEGACY_RAV_RIV_UTI};

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

pub(super) fn handler_display_name(path: &Path) -> Option<String> {
    use objc2_foundation::{NSBundle, NSString};

    let bundle_path = path.to_string_lossy();
    let bundle = NSBundle::bundleWithPath(&NSString::from_str(bundle_path.as_ref()));
    let info_value = |key: &str| {
        bundle
            .as_ref()?
            .objectForInfoDictionaryKey(&NSString::from_str(key))?
            .downcast::<NSString>()
            .ok()
            .and_then(|value| non_empty(value.to_string()))
    };

    info_value("CFBundleDisplayName")
        .or_else(|| info_value("CFBundleName"))
        .or_else(|| {
            path.file_stem()
                .map(|name| name.to_string_lossy().to_string())
                .and_then(non_empty)
        })
}

fn bundle_identifier(path: &Path) -> Option<String> {
    use objc2_foundation::{NSBundle, NSString};

    let bundle_path = path.to_string_lossy();
    NSBundle::bundleWithPath(&NSString::from_str(bundle_path.as_ref()))
        .and_then(|bundle| bundle.bundleIdentifier())
        .and_then(|identifier| non_empty(identifier.to_string()))
}

pub(super) async fn query_default_handlers(
    app: &tauri::AppHandle,
    current_bundle: PathBuf,
) -> Result<RivDefaultAppStatus, String> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::NSString;
    use objc2_uniform_type_identifiers::UTType;

    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let result = (|| {
            let workspace = NSWorkspace::sharedWorkspace();
            let canonical_type = UTType::typeWithIdentifier(&NSString::from_str(CANONICAL_RIV_UTI))
                .ok_or_else(|| format!("macOS does not recognize {CANONICAL_RIV_UTI}"))?;
            let legacy_type =
                UTType::typeWithIdentifier(&NSString::from_str(LEGACY_RAV_RIV_UTI))
                    .ok_or_else(|| format!("macOS does not recognize {LEGACY_RAV_RIV_UTI}"))?;
            let canonical_handler = workspace
                .URLForApplicationToOpenContentType(&canonical_type)
                .and_then(|url| url.to_file_path());
            let legacy_handler = workspace
                .URLForApplicationToOpenContentType(&legacy_type)
                .and_then(|url| url.to_file_path());
            Ok(status_from_handlers(
                &current_bundle,
                canonical_handler,
                legacy_handler,
            ))
        })();
        let _ = sender.send(result);
    })
    .map_err(|error| format!("failed to query default .riv app: {error}"))?;
    receiver
        .await
        .map_err(|_| "default .riv app query was cancelled".to_string())?
}

pub(super) async fn status_after_failed_change(
    app: &tauri::AppHandle,
    current_bundle: PathBuf,
    reason: String,
) -> RivDefaultAppStatus {
    match query_default_handlers(app, current_bundle.clone()).await {
        Ok(mut status) => {
            status.reason = Some(reason);
            status
        }
        Err(query_reason) => RivDefaultAppStatus::unavailable(
            format!("{reason}; status check failed: {query_reason}"),
            Some(&current_bundle),
        ),
    }
}

pub(super) fn status_from_handlers(
    current_bundle: &Path,
    canonical_handler: Option<PathBuf>,
    legacy_handler: Option<PathBuf>,
) -> RivDefaultAppStatus {
    let normalize = |path: PathBuf| std::fs::canonicalize(&path).unwrap_or(path);
    let current_bundle = normalize(current_bundle.to_path_buf());
    let canonical_handler = canonical_handler.map(normalize);
    let legacy_handler = legacy_handler.map(normalize);
    let current_bundle_identifier = bundle_identifier(&current_bundle);
    let canonical_is_rav = canonical_handler.as_deref() == Some(current_bundle.as_path());
    let legacy_is_rav = legacy_handler.as_deref() == Some(current_bundle.as_path());
    let is_another_rav_copy = |handler: &Path| {
        handler != current_bundle.as_path()
            && current_bundle_identifier.is_some()
            && bundle_identifier(handler) == current_bundle_identifier
    };
    let canonical_is_another_rav_copy = canonical_handler
        .as_deref()
        .is_some_and(&is_another_rav_copy);
    let legacy_is_another_rav_copy = legacy_handler.as_deref().is_some_and(&is_another_rav_copy);
    let has_non_rav_handler = [canonical_handler.as_deref(), legacy_handler.as_deref()]
        .into_iter()
        .flatten()
        .any(|handler| handler != current_bundle.as_path() && !is_another_rav_copy(handler));
    let state = if canonical_is_rav && legacy_is_rav {
        "rav-default"
    } else if (canonical_is_another_rav_copy || legacy_is_another_rav_copy) && !has_non_rav_handler
    {
        "rav-other-copy"
    } else if canonical_is_rav
        || legacy_is_rav
        || canonical_handler.is_none()
        || legacy_handler.is_none()
    {
        "partial"
    } else {
        "other-app"
    };
    let handler_name = if state == "rav-default" {
        Some("RAV".into())
    } else if state == "rav-other-copy" {
        Some("Another RAV copy".into())
    } else {
        canonical_handler
            .as_deref()
            .and_then(handler_display_name)
            .or_else(|| {
                canonical_handler
                    .is_none()
                    .then(|| legacy_handler.as_deref().and_then(handler_display_name))
                    .flatten()
            })
    };

    RivDefaultAppStatus {
        available: true,
        state: state.into(),
        handler_name,
        reason: (state == "rav-other-copy").then(|| {
            let handlers = [
                ("canonical", canonical_handler.as_deref()),
                ("legacy", legacy_handler.as_deref()),
            ]
            .into_iter()
            .filter_map(|(kind, handler)| {
                handler
                    .filter(|path| is_another_rav_copy(path))
                    .map(|path| format!("{kind}: {}", path.display()))
            })
            .collect::<Vec<_>>()
            .join("; ");
            format!("macOS is still using another installed RAV copy ({handlers}).")
        }),
        canonical_handler_path: canonical_handler.as_deref().map(path_string),
        legacy_handler_path: legacy_handler.as_deref().map(path_string),
        current_bundle_path: Some(path_string(&current_bundle)),
    }
}

pub(super) async fn set_default_handler(
    app: &tauri::AppHandle,
    bundle: PathBuf,
    type_identifier: &'static str,
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSError, NSString, NSURL};
    use objc2_uniform_type_identifiers::UTType;
    use std::sync::{Arc, Mutex};

    let (sender, receiver) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let sender = Arc::new(Mutex::new(Some(sender)));
    app.run_on_main_thread(move || {
        let fail_before_request = |message: String| {
            if let Ok(mut slot) = sender.lock() {
                if let Some(sender) = slot.take() {
                    let _ = sender.send(Err(message));
                }
            }
        };
        let Some(application_url) = NSURL::from_directory_path(&bundle) else {
            fail_before_request("failed to create RAV application URL".into());
            return;
        };
        let Some(content_type) = UTType::typeWithIdentifier(&NSString::from_str(type_identifier))
        else {
            fail_before_request(format!("macOS does not recognize {type_identifier}"));
            return;
        };
        let completion_sender = Arc::clone(&sender);
        let completion = RcBlock::new(move |error: *mut NSError| {
            let result = if error.is_null() {
                Ok(())
            } else {
                // SAFETY: AppKit supplies either null or a valid NSError for
                // the duration of the completion-handler invocation.
                let description = unsafe { &*error }.localizedDescription().to_string();
                Err(format!(
                    "macOS could not set RAV as the default for {type_identifier}: {description}"
                ))
            };
            if let Ok(mut slot) = completion_sender.lock() {
                if let Some(sender) = slot.take() {
                    let _ = sender.send(result);
                }
            }
        });
        NSWorkspace::sharedWorkspace()
            .setDefaultApplicationAtURL_toOpenContentType_completionHandler(
                &application_url,
                &content_type,
                Some(&completion),
            );
    })
    .map_err(|error| format!("failed to request the default .riv app change: {error}"))?;

    tokio::time::timeout(std::time::Duration::from_secs(10), receiver)
        .await
        .map_err(|_| format!("timed out while setting the default app for {type_identifier}"))?
        .map_err(|_| format!("default app request for {type_identifier} was cancelled"))?
}
