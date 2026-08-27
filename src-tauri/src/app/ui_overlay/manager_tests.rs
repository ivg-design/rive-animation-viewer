use super::{UiOverlayManager, UI_OVERLAY_MAX_STATE_BYTES};
use crate::app::ui_overlay::types::{ShowUiOverlayRequest, UiOverlayBounds};
use tokio::sync::oneshot;
use tokio::time::Duration;

fn request() -> ShowUiOverlayRequest {
    ShowUiOverlayRequest {
        purpose: "settings".into(),
        bounds: UiOverlayBounds {
            x: 0.0,
            y: 0.0,
            width: 520.0,
            height: 300.0,
        },
        request_token: "M9E1PYZC0HcUtxhqX-eoC3m8Wz4wD7vB".into(),
        state: serde_json::json!({}),
        focus: true,
    }
}

#[test]
fn replacement_commits_without_dropping_the_active_overlay_first() {
    let manager = UiOverlayManager::default();
    let (first, mut first_ready) = manager.stage(request()).unwrap();
    assert!(manager
        .acknowledge_adoption(&first.label)
        .unwrap()
        .is_none());
    assert!(manager
        .prepare_pending(&first.label, first.epoch, "settings")
        .unwrap()
        .is_some());
    assert!(matches!(
        first_ready.try_recv(),
        Err(oneshot::error::TryRecvError::Empty)
    ));
    assert!(manager
        .acknowledge_adoption(&first.label)
        .unwrap()
        .is_some());
    let (second, _second_ready) = manager.stage(request()).unwrap();
    assert_eq!(manager.active().unwrap().unwrap().epoch, first.epoch);
    assert!(manager
        .prepare_pending(&second.label, second.epoch, "settings")
        .unwrap()
        .is_some());
    manager
        .acknowledge_adoption(&second.label)
        .unwrap()
        .unwrap();
    assert_eq!(manager.retiring().unwrap()[0].epoch, first.epoch);
    assert_eq!(manager.active().unwrap().unwrap().epoch, second.epoch);
}

#[test]
fn duplicate_ready_cannot_reopen_the_pending_overlay() {
    let manager = UiOverlayManager::default();
    let (resource, _ready) = manager.stage(request()).unwrap();
    assert!(manager
        .prepare_pending(&resource.label, resource.epoch, "settings")
        .unwrap()
        .is_some());
    assert!(manager
        .prepare_pending(&resource.label, resource.epoch, "settings")
        .unwrap()
        .is_none());
}

#[test]
fn expected_close_matches_an_active_or_pending_epoch_and_drains_both() {
    let manager = UiOverlayManager::default();
    let (first, _ready) = manager.stage(request()).unwrap();
    manager
        .prepare_pending(&first.label, first.epoch, "settings")
        .unwrap();
    manager.acknowledge_adoption(&first.label).unwrap();
    let (second, _ready) = manager.stage(request()).unwrap();
    manager.retire_for_close(Some(second.epoch)).unwrap();
    assert_eq!(manager.retiring().unwrap().len(), 2);
    assert!(manager.active().unwrap().is_none());
    assert!(!manager.has_pending().unwrap());
}

#[tokio::test]
async fn waits_for_initial_pending_adoption_before_restacking() {
    let manager = std::sync::Arc::new(UiOverlayManager::default());
    let (resource, _ready) = manager.stage(request()).unwrap();
    let waiting = {
        let manager = manager.clone();
        tokio::spawn(async move {
            manager
                .wait_for_active_or_pending_resolution(Duration::from_millis(250))
                .await
        })
    };
    tokio::time::sleep(Duration::from_millis(10)).await;
    manager
        .prepare_pending(&resource.label, resource.epoch, "settings")
        .unwrap();
    manager.acknowledge_adoption(&resource.label).unwrap();
    let active = waiting.await.unwrap().unwrap().unwrap();
    assert_eq!(active.epoch, resource.epoch);
}

#[test]
fn retired_resources_remain_retryable_until_their_close_is_acknowledged() {
    let manager = UiOverlayManager::default();
    let (resource, _ready) = manager.stage(request()).unwrap();
    manager.reject_pending(&resource.label).unwrap();

    assert!(manager.active().unwrap().is_none());
    assert!(!manager.has_pending().unwrap());
    assert_eq!(manager.retiring().unwrap()[0].label, resource.label);

    assert!(manager.mark_retired_closed(&resource.label).unwrap());
    assert!(manager.retiring().unwrap().is_empty());
}

#[test]
fn expected_close_retries_an_already_retired_epoch() {
    let manager = UiOverlayManager::default();
    let (resource, _ready) = manager.stage(request()).unwrap();
    manager.reject_pending(&resource.label).unwrap();

    manager.retire_for_close(Some(resource.epoch)).unwrap();
    assert_eq!(manager.retiring().unwrap()[0].label, resource.label);
}

#[test]
fn stale_close_for_retiring_epoch_preserves_newer_active_overlay() {
    let manager = UiOverlayManager::default();
    let (first, _ready) = manager.stage(request()).unwrap();
    manager
        .prepare_pending(&first.label, first.epoch, "settings")
        .unwrap();
    manager.acknowledge_adoption(&first.label).unwrap();

    let (second, _ready) = manager.stage(request()).unwrap();
    manager
        .prepare_pending(&second.label, second.epoch, "settings")
        .unwrap();
    manager.acknowledge_adoption(&second.label).unwrap();
    assert_eq!(manager.retiring().unwrap()[0].epoch, first.epoch);

    manager.retire_for_close(Some(first.epoch)).unwrap();

    assert_eq!(manager.active().unwrap().unwrap().epoch, second.epoch);
    assert!(!manager.has_pending().unwrap());
    assert_eq!(manager.retiring().unwrap()[0].epoch, first.epoch);
}

#[test]
fn stale_prepared_candidate_is_retired_when_superseded_before_adoption() {
    let manager = UiOverlayManager::default();
    let (stale, _ready) = manager.stage(request()).unwrap();
    manager
        .prepare_pending(&stale.label, stale.epoch, "settings")
        .unwrap();

    let (replacement, _ready) = manager.stage(request()).unwrap();
    assert!(manager
        .acknowledge_adoption(&stale.label)
        .unwrap()
        .is_none());
    assert!(manager.retire_failed_adoption(&stale.label).unwrap());
    assert!(manager.prepared_pending(&stale.label).unwrap().is_none());
    assert!(manager.active().unwrap().is_none());
    assert_eq!(manager.retiring().unwrap()[0].label, stale.label);
    assert!(manager
        .prepared_pending(&replacement.label)
        .unwrap()
        .is_none());
}

#[test]
fn incremental_state_updates_preserve_the_stored_export_hierarchy() {
    let manager = UiOverlayManager::default();
    let mut export_request = request();
    export_request.purpose = "export".into();
    export_request.state = serde_json::json!({
        "hierarchy": { "children": [{ "label": "TrackMapVM" }] },
        "hierarchyRevision": 12,
        "selectedControlKeys": ["vm:driver:number"],
    });
    let (resource, _ready) = manager.stage(export_request).unwrap();
    manager
        .prepare_pending(&resource.label, resource.epoch, "export")
        .unwrap();
    manager.acknowledge_adoption(&resource.label).unwrap();

    let updated = manager
        .update_active_state(
            resource.epoch,
            serde_json::json!({ "selectedControlKeys": ["vm:lap:number"] }),
        )
        .unwrap()
        .unwrap();

    assert_eq!(updated.request.state["hierarchyRevision"], 12);
    assert_eq!(
        updated.request.state["hierarchy"]["children"][0]["label"],
        "TrackMapVM"
    );
    assert_eq!(
        updated.request.state["selectedControlKeys"][0],
        "vm:lap:number"
    );
}

#[test]
fn rejects_an_oversized_merged_state_without_mutating_the_active_snapshot() {
    let manager = UiOverlayManager::default();
    let mut export_request = request();
    export_request.purpose = "export".into();
    export_request.state = serde_json::json!({
        "hierarchy": "h".repeat(UI_OVERLAY_MAX_STATE_BYTES / 2),
    });
    let (resource, _ready) = manager.stage(export_request).unwrap();
    manager
        .prepare_pending(&resource.label, resource.epoch, "export")
        .unwrap();
    manager.acknowledge_adoption(&resource.label).unwrap();

    assert!(manager
        .update_active_state(
            resource.epoch,
            serde_json::json!({
                "previewText": "p".repeat(UI_OVERLAY_MAX_STATE_BYTES / 2),
            }),
        )
        .is_err());
    let active = manager.active().unwrap().unwrap();
    assert!(active.request.state.get("previewText").is_none());
    assert_eq!(
        active.request.state["hierarchy"].as_str().unwrap().len(),
        UI_OVERLAY_MAX_STATE_BYTES / 2,
    );
}
