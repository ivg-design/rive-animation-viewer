use super::{RenderSurfaceRegistry, SurfaceResource};
use crate::app::render_surface::geometry::RenderSurfaceBounds;

fn bounds() -> RenderSurfaceBounds {
    RenderSurfaceBounds::new(10.0, 20.0, 300.0, 200.0).unwrap()
}

fn staged(registry: &mut RenderSurfaceRegistry, session: &str, label: &str) {
    registry.stage(session.to_string(), label.to_string(), bounds());
}

fn registry_with_active() -> RenderSurfaceRegistry {
    RenderSurfaceRegistry {
        active: Some(SurfaceResource {
            session_id: "active".to_string(),
            label: "render-surface-active".to_string(),
            target_bounds: bounds(),
        }),
        ..Default::default()
    }
}

#[test]
fn activation_keeps_previous_active_until_commit() {
    let mut registry = registry_with_active();
    staged(&mut registry, "next", "render-surface-next");
    let plan = registry.activation_plan("next").expect("activation plan");
    assert_eq!(
        plan.previous.as_ref().map(|surface| surface.label.as_str()),
        Some("render-surface-active"),
    );
    assert_eq!(registry.active_label().unwrap(), "render-surface-active");
    registry
        .commit_activation(&plan)
        .expect("activate staged surface");
    assert_eq!(registry.active_label().unwrap(), "render-surface-next");
    assert!(registry.activation_plan("next").is_err());
    assert!(registry
        .managed_labels()
        .contains(&"render-surface-active".to_string()));
    assert_eq!(
        registry.retired,
        plan.previous.into_iter().collect::<Vec<_>>()
    );
}

#[test]
fn rejects_stale_and_duplicate_activation_commits() {
    let mut registry = RenderSurfaceRegistry::default();
    staged(&mut registry, "next", "render-surface-next-a");
    let stale_plan = registry.activation_plan("next").expect("activation plan");
    staged(&mut registry, "next", "render-surface-next-b");
    assert!(registry.commit_activation(&stale_plan).is_err());
    assert!(registry.active_label().is_err());
    let current_plan = registry.activation_plan("next").expect("current plan");
    registry
        .commit_activation(&current_plan)
        .expect("activate once");
    assert!(registry.commit_activation(&current_plan).is_err());
}

#[test]
fn routes_session_messages_to_pending_and_other_messages_to_active() {
    let mut registry = registry_with_active();
    staged(&mut registry, "pending", "render-surface-pending");
    assert_eq!(
        registry.route_label(Some("pending")).unwrap(),
        "render-surface-pending"
    );
    assert!(registry.route_label(Some("stale-session")).is_err());
    assert_eq!(
        registry.route_label(Some("active")).unwrap(),
        "render-surface-active"
    );
    assert_eq!(registry.route_label(None).unwrap(), "render-surface-active");
}

#[test]
fn first_ready_can_route_to_a_candidate_before_its_child_is_shown() {
    let mut registry = registry_with_active();
    let candidate = SurfaceResource {
        session_id: "candidate".to_string(),
        label: "render-surface-candidate".to_string(),
        target_bounds: bounds(),
    };

    // Creation stages the label before native add_child/show can start the
    // document. This models a zero-delay child ready beacon.
    registry.stage(
        candidate.session_id.clone(),
        candidate.label.clone(),
        candidate.target_bounds,
    );
    assert_eq!(
        registry.route_label(Some("candidate")).unwrap(),
        "render-surface-candidate"
    );
    assert_eq!(registry.active_label().unwrap(), "render-surface-active");

    assert!(registry.rollback_pending_surface(&candidate));
    assert!(registry.route_label(Some("candidate")).is_err());
    assert_eq!(registry.active_label().unwrap(), "render-surface-active");
}

#[test]
fn injected_pre_commit_activation_failure_keeps_the_predecessor_authoritative() {
    let mut registry = registry_with_active();
    staged(&mut registry, "candidate", "render-surface-candidate");
    let plan = registry
        .activation_plan("candidate")
        .expect("activation plan");

    // Native positioning/showing happens before commit. Injecting a failure at
    // that boundary means commit is never called: the predecessor must remain
    // active while the candidate stays staged for explicit rollback/retry.
    let native_result: Result<(), &str> = Err("injected native show failure");
    assert!(native_result.is_err());
    assert_eq!(registry.active_label().unwrap(), "render-surface-active");
    assert_eq!(
        registry.route_label(Some("candidate")).unwrap(),
        "render-surface-candidate"
    );
    assert_eq!(registry.activation_plan("candidate").unwrap(), plan);

    assert!(registry.rollback_pending_surface(&plan.next));
    assert_eq!(registry.active_label().unwrap(), "render-surface-active");
    assert!(registry.route_label(Some("candidate")).is_err());
}

#[test]
fn late_child_receipt_after_failed_candidate_rollback_is_unroutable() {
    let mut registry = registry_with_active();
    staged(&mut registry, "failed", "render-surface-failed");
    let failed = registry.pending_surface("failed").unwrap();
    assert!(registry.rollback_pending_surface(&failed));

    // A ready/loaded/ACK beacon arriving after native creation rollback uses
    // the retired session id. Routing it must fail without affecting the
    // predecessor that remained visible throughout the failed transaction.
    assert!(registry.route_label(Some("failed")).is_err());
    assert_eq!(registry.active_label().unwrap(), "render-surface-active");

    staged(&mut registry, "replacement", "render-surface-replacement");
    let replacement = registry.activation_plan("replacement").unwrap();
    registry.commit_activation(&replacement).unwrap();
    assert_eq!(
        registry.active_label().unwrap(),
        "render-surface-replacement"
    );
    assert!(registry.route_label(Some("failed")).is_err());
}

#[test]
fn rollback_of_an_old_candidate_cannot_remove_a_newer_same_session_stage() {
    let mut registry = RenderSurfaceRegistry::default();
    let old = SurfaceResource {
        session_id: "candidate".to_string(),
        label: "render-surface-old".to_string(),
        target_bounds: bounds(),
    };
    let newer = SurfaceResource {
        session_id: "candidate".to_string(),
        label: "render-surface-new".to_string(),
        target_bounds: bounds(),
    };
    registry.stage(old.session_id.clone(), old.label.clone(), old.target_bounds);
    registry.stage(
        newer.session_id.clone(),
        newer.label.clone(),
        newer.target_bounds,
    );

    assert!(!registry.rollback_pending_surface(&old));
    assert_eq!(
        registry.route_label(Some("candidate")).unwrap(),
        "render-surface-new"
    );
}

#[test]
fn release_is_idempotent_and_does_not_clear_another_active_surface() {
    let mut registry = registry_with_active();
    staged(&mut registry, "pending", "render-surface-pending");
    let pending = registry.pending_surface("pending").unwrap();
    assert_eq!(registry.pending_surface("pending"), Some(pending.clone()));
    registry.release_surface(&pending);
    registry.release_surface(&pending);
    assert!(registry.pending_surface("pending").is_none());
    assert_eq!(registry.active_label().unwrap(), "render-surface-active");
}

#[test]
fn managed_labels_include_active_and_pending_without_duplicates() {
    let mut registry = registry_with_active();
    staged(&mut registry, "same", "render-surface-active");
    staged(&mut registry, "next", "render-surface-next");
    let labels = registry.managed_labels();
    assert_eq!(labels.len(), 2);
    assert!(labels.contains(&"render-surface-active".to_string()));
    assert!(labels.contains(&"render-surface-next".to_string()));
    registry.clear();
    assert!(registry.managed_labels().is_empty());
}

#[test]
fn shutdown_snapshot_contains_active_multiple_pending_and_retired_once_each() {
    let mut registry = registry_with_active();
    staged(&mut registry, "pending-a", "render-surface-pending-a");
    staged(&mut registry, "pending-b", "render-surface-pending-b");
    registry.record_retired(SurfaceResource {
        session_id: "retired".to_string(),
        label: "render-surface-retired".to_string(),
        target_bounds: bounds(),
    });
    // A duplicated native label must still be closed exactly once.
    staged(&mut registry, "duplicate-label", "render-surface-active");

    let surfaces = registry.managed_surfaces();
    let labels = surfaces
        .iter()
        .map(|surface| surface.label.as_str())
        .collect::<Vec<_>>();
    assert_eq!(labels.len(), 4);
    for expected in [
        "render-surface-active",
        "render-surface-pending-a",
        "render-surface-pending-b",
        "render-surface-retired",
    ] {
        assert_eq!(labels.iter().filter(|label| **label == expected).count(), 1);
    }

    // Model close_all_render_surfaces retiring the immutable snapshot. Each
    // release must leave no routable active or pending resource behind.
    for surface in surfaces {
        registry.release_surface(&surface);
    }
    assert!(registry.managed_surfaces().is_empty());
    assert!(registry.active_label().is_err());
    assert!(registry.route_label(Some("pending-a")).is_err());
    assert!(registry.route_label(Some("pending-b")).is_err());
}

#[test]
fn concurrent_activation_plan_cannot_replace_a_newer_active_surface() {
    let mut registry = registry_with_active();
    staged(&mut registry, "first", "render-surface-first");
    staged(&mut registry, "second", "render-surface-second");
    let first = registry.activation_plan("first").unwrap();
    let second = registry.activation_plan("second").unwrap();
    registry.commit_activation(&first).unwrap();
    assert!(registry.commit_activation(&second).is_err());
    assert_eq!(registry.active_label().unwrap(), "render-surface-first");
}

#[test]
fn retired_surfaces_remain_managed_for_final_cleanup() {
    let mut registry = registry_with_active();
    let retired = SurfaceResource {
        session_id: "retired".to_string(),
        label: "render-surface-retired".to_string(),
        target_bounds: bounds(),
    };
    registry.record_retired(retired.clone());
    registry.record_retired(retired);
    let labels = registry.managed_labels();
    assert_eq!(
        labels
            .iter()
            .filter(|label| *label == "render-surface-retired")
            .count(),
        1
    );
}

#[test]
fn failed_cache_delete_stays_tracked_until_a_later_retry_succeeds() {
    let mut registry = RenderSurfaceRegistry::default();
    registry.record_cache_retry("stale-session".to_string());
    registry.record_cache_retry("stale-session".to_string());
    assert_eq!(registry.cache_retry_sessions(), vec!["stale-session"]);
    registry.release_cache_retry("stale-session");
    assert!(registry.cache_retry_sessions().is_empty());
}

#[test]
fn bounds_updates_keep_active_target_onscreen_and_pending_target_staged() {
    let mut registry = registry_with_active();
    staged(&mut registry, "pending", "render-surface-pending");
    let replacement = RenderSurfaceBounds::new(40.0, 50.0, 900.0, 600.0).unwrap();
    let resources = registry.apply_bounds(replacement);
    let active = resources
        .iter()
        .find(|surface| surface.resource.session_id == "active")
        .unwrap();
    let pending = resources
        .iter()
        .find(|surface| surface.resource.session_id == "pending")
        .unwrap();
    assert!(!active.staged);
    assert!(pending.staged);
    assert_eq!(active.resource.target_bounds, replacement);
    assert_eq!(pending.resource.target_bounds, replacement);
    assert!(pending
        .resource
        .target_bounds
        .staged()
        .is_fully_offscreen_left());
}

#[test]
fn cleanup_identity_survives_a_bounds_update() {
    let mut registry = RenderSurfaceRegistry::default();
    staged(&mut registry, "pending", "render-surface-pending");
    let original = registry.pending_surface("pending").unwrap();
    registry.apply_bounds(RenderSurfaceBounds::new(50.0, 60.0, 800.0, 600.0).unwrap());
    assert_eq!(registry.pending_surface("pending"), Some(original.clone()));
    registry.release_surface(&original);
    assert!(registry.pending_surface("pending").is_none());
}

#[test]
fn activation_commits_latest_pending_bounds_after_a_resize() {
    let mut registry = registry_with_active();
    staged(&mut registry, "pending", "render-surface-pending");
    let plan = registry.activation_plan("pending").unwrap();
    let replacement = RenderSurfaceBounds::new(80.0, 90.0, 1024.0, 768.0).unwrap();
    registry.apply_bounds(replacement);
    let activated = registry
        .commit_activation(&plan)
        .expect("resize must not invalidate activation");
    assert_eq!(activated.target_bounds, replacement);
    assert_eq!(registry.active.as_ref(), Some(&activated));
    assert!(registry.pending_surface("pending").is_none());
}
