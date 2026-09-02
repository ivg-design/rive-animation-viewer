use std::path::{Path, PathBuf};

use super::{
    path_string, RivContentTypeHandlerStatus, RivDefaultAppStatus, CANONICAL_RIV_UTI,
    KNOWN_RIV_UTIS, LEGACY_RAV_RIV_UTI, PLAY_RIV_UTI, RIVIEW_RIV_UTI,
};

#[derive(Debug, Default)]
pub(super) struct HandlerSnapshot {
    pub(super) resolved_content_type: Option<String>,
    pub(super) handlers: Vec<(String, Option<PathBuf>)>,
}

fn push_unique_identifier(identifiers: &mut Vec<String>, identifier: impl Into<String>) {
    let identifier = identifier.into();
    let identifier = identifier.trim();
    if !identifier.is_empty() && !identifiers.iter().any(|known| known == identifier) {
        identifiers.push(identifier.to_string());
    }
}

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
    use objc2_uniform_type_identifiers::{UTTagClassFilenameExtension, UTType};

    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let result = (|| {
            let workspace = NSWorkspace::sharedWorkspace();
            let extension = NSString::from_str("riv");
            let resolved_type = UTType::typeWithFilenameExtension(&extension)
                .ok_or_else(|| "macOS could not resolve the .riv content type".to_string())?;
            let resolved_content_type = non_empty(resolved_type.identifier().to_string());
            let mut identifiers = Vec::new();
            if let Some(identifier) = resolved_content_type.as_deref() {
                push_unique_identifier(&mut identifiers, identifier);
            }
            // SAFETY: UTTagClassFilenameExtension is an immutable framework
            // constant available on every supported macOS version.
            let extension_tag_class = unsafe { UTTagClassFilenameExtension };
            let discovered_types = UTType::typesWithTag_tagClass_conformingToType(
                &extension,
                extension_tag_class,
                None,
            );
            for content_type in discovered_types.iter() {
                push_unique_identifier(&mut identifiers, content_type.identifier().to_string());
            }
            for identifier in KNOWN_RIV_UTIS {
                push_unique_identifier(&mut identifiers, identifier);
            }
            let handlers = identifiers
                .into_iter()
                .map(|identifier| {
                    let handler = UTType::typeWithIdentifier(&NSString::from_str(&identifier))
                        .and_then(|content_type| {
                            workspace
                                .URLForApplicationToOpenContentType(&content_type)
                                .and_then(|url| url.to_file_path())
                        });
                    (identifier, handler)
                })
                .collect();
            Ok(status_from_handlers(
                &current_bundle,
                HandlerSnapshot {
                    resolved_content_type,
                    handlers,
                },
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
    snapshot: HandlerSnapshot,
) -> RivDefaultAppStatus {
    let normalize = |path: PathBuf| std::fs::canonicalize(&path).unwrap_or(path);
    let current_bundle = normalize(current_bundle.to_path_buf());
    let resolved_content_type = snapshot.resolved_content_type;
    let handlers = snapshot
        .handlers
        .into_iter()
        .map(|(identifier, handler)| (identifier, handler.map(&normalize)))
        .collect::<Vec<_>>();
    let current_bundle_identifier = bundle_identifier(&current_bundle);
    let is_another_rav_copy = |handler: &Path| {
        handler != current_bundle.as_path()
            && current_bundle_identifier.is_some()
            && bundle_identifier(handler) == current_bundle_identifier
    };
    // The user-facing setting represents the effective association for a .riv
    // document. Registered aliases are retained below as diagnostics, but they
    // are not separate tasks the user must click through. macOS resolves the
    // extension to one preferred UTType, and one explicit request for that type
    // updates the effective document association.
    let primary_handler = resolved_content_type
        .as_deref()
        .and_then(|identifier| {
            handlers
                .iter()
                .find(|(candidate, _)| candidate == identifier)
                .and_then(|(_, handler)| handler.as_deref())
        })
        .or_else(|| handlers.iter().find_map(|(_, handler)| handler.as_deref()));
    let state = if primary_handler == Some(current_bundle.as_path()) {
        "rav-default"
    } else if primary_handler.is_some_and(&is_another_rav_copy) {
        "rav-other-copy"
    } else {
        "other-app"
    };
    let handler_name = if state == "rav-default" {
        Some("RAV".into())
    } else if state == "rav-other-copy" {
        Some("Another RAV copy".into())
    } else {
        primary_handler.and_then(handler_display_name)
    };
    let handler_path_for = |identifier: &str| {
        handlers
            .iter()
            .find(|(candidate, _)| candidate == identifier)
            .and_then(|(_, handler)| handler.as_deref())
            .map(path_string)
    };
    let resolved_handler_path = resolved_content_type.as_deref().and_then(&handler_path_for);
    let current_bundle_path = path_string(&current_bundle);
    let content_type_handlers = handlers
        .iter()
        .map(|(content_type, handler)| RivContentTypeHandlerStatus {
            content_type: content_type.clone(),
            handler_path: handler.as_deref().map(path_string),
        })
        .collect::<Vec<_>>();
    let reason = if state == "rav-other-copy" {
        let handler = primary_handler
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "unknown path".into());
        Some(format!(
            "macOS is still using another installed RAV copy ({handler})."
        ))
    } else {
        None
    };

    RivDefaultAppStatus {
        available: true,
        state: state.into(),
        handler_name,
        reason,
        resolved_content_type,
        resolved_handler_path,
        canonical_handler_path: handler_path_for(CANONICAL_RIV_UTI),
        riview_handler_path: handler_path_for(RIVIEW_RIV_UTI),
        play_handler_path: handler_path_for(PLAY_RIV_UTI),
        legacy_handler_path: handler_path_for(LEGACY_RAV_RIV_UTI),
        content_type_handlers,
        current_bundle_path: Some(current_bundle_path),
    }
}

pub(super) async fn set_default_handler(
    app: &tauri::AppHandle,
    bundle: PathBuf,
    type_identifier: String,
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSError, NSString, NSURL};
    use objc2_uniform_type_identifiers::UTType;
    use std::sync::{Arc, Mutex};

    let (sender, receiver) = tokio::sync::oneshot::channel::<Result<(), String>>();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let type_identifier_for_request = type_identifier.clone();
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
        let Some(content_type) =
            UTType::typeWithIdentifier(&NSString::from_str(&type_identifier_for_request))
        else {
            fail_before_request(format!(
                "macOS does not recognize {type_identifier_for_request}"
            ));
            return;
        };
        let type_identifier_for_completion = type_identifier_for_request.clone();
        let completion_sender = Arc::clone(&sender);
        let completion = RcBlock::new(move |error: *mut NSError| {
            let result = if error.is_null() {
                Ok(())
            } else {
                // SAFETY: AppKit supplies either null or a valid NSError for
                // the duration of the completion-handler invocation.
                let description = unsafe { &*error }.localizedDescription().to_string();
                Err(format!(
                    "macOS could not set RAV as the default for {type_identifier_for_completion}: {description}"
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
