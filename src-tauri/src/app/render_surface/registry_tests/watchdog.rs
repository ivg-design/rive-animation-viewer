use super::{registry_with_active, staged};
use crate::app::render_surface::registry::RenderSurfaceRegistry;

#[test]
fn activation_watchdog_replaces_only_the_staged_child_and_retries_once() {
    let mut registry = registry_with_active();
    staged(&mut registry, "pending", "render-surface-pending");
    let ticket = registry.arm_activation_watchdog("pending").unwrap();

    let retry = registry
        .begin_activation_watchdog_retry(
            &ticket,
            "render-surface-pending-watchdog-retry-1".to_string(),
        )
        .expect("first watchdog deadline starts one retry");

    assert_eq!(retry.expired.label, "render-surface-pending");
    assert_eq!(retry.expired.activation_attempt, 0);
    assert_eq!(
        retry.replacement.label,
        "render-surface-pending-watchdog-retry-1"
    );
    assert_eq!(retry.replacement.activation_attempt, 1);
    assert_eq!(registry.active_label().unwrap(), "render-surface-active");
    assert!(registry
        .routable_surface_for_label("render-surface-pending")
        .is_none());
    assert_eq!(
        registry
            .routable_surface_for_label("render-surface-pending-watchdog-retry-1")
            .unwrap(),
        retry.replacement
    );

    assert!(registry
        .begin_activation_watchdog_retry(
            &ticket,
            "render-surface-pending-watchdog-retry-2".to_string(),
        )
        .is_none());
}

#[test]
fn first_frame_or_activation_disarms_the_native_watchdog() {
    let mut registry = registry_with_active();
    staged(&mut registry, "frame", "render-surface-frame");
    let frame_ticket = registry.arm_activation_watchdog("frame").unwrap();
    assert_eq!(
        registry
            .acknowledge_first_frame("render-surface-frame")
            .unwrap()
            .activation_attempt,
        0
    );
    assert!(registry
        .begin_activation_watchdog_retry(
            &frame_ticket,
            "render-surface-frame-watchdog-retry-1".to_string(),
        )
        .is_none());

    staged(&mut registry, "commit", "render-surface-commit");
    let commit_ticket = registry.arm_activation_watchdog("commit").unwrap();
    let plan = registry.activation_plan("commit").unwrap();
    registry.commit_activation(&plan).unwrap();
    assert!(registry
        .begin_activation_watchdog_retry(
            &commit_ticket,
            "render-surface-commit-watchdog-retry-1".to_string(),
        )
        .is_none());
}

#[test]
fn a_new_same_session_stage_invalidates_an_older_watchdog_ticket() {
    let mut registry = RenderSurfaceRegistry::default();
    staged(&mut registry, "pending", "render-surface-pending-old");
    let stale_ticket = registry.arm_activation_watchdog("pending").unwrap();
    staged(&mut registry, "pending", "render-surface-pending-new");
    let current_ticket = registry.arm_activation_watchdog("pending").unwrap();

    assert!(registry
        .begin_activation_watchdog_retry(&stale_ticket, "render-surface-stale-retry".to_string(),)
        .is_none());
    assert!(registry
        .begin_activation_watchdog_retry(
            &current_ticket,
            "render-surface-current-retry".to_string(),
        )
        .is_some());
}
