use crate::app::render_surface::{
    activation::{converge_committed_bounds, prepare_staged_surface_for_activation},
    geometry::RenderSurfaceBounds,
    native_loss::handle_missing_active_surface,
    registry::{RenderSurfaceManager, RenderSurfaceRegistry, SurfaceResource},
};

#[test]
fn injected_post_commit_bounds_failure_keeps_the_committed_surface_authoritative() {
    let initial = RenderSurfaceBounds::new(10.0, 20.0, 300.0, 200.0).unwrap();
    let updated = RenderSurfaceBounds::new(40.0, 50.0, 640.0, 360.0).unwrap();
    let mut registry = RenderSurfaceRegistry::default();
    registry.stage("next".into(), "render-surface-next".into(), initial);
    let plan = registry.activation_plan("next").unwrap();
    registry.apply_bounds(updated);
    let activated = registry.commit_activation(&plan).unwrap();

    let mut attempts = 0;
    converge_committed_bounds(&activated, &plan.next, |_| {
        attempts += 1;
        Err("injected post-commit bounds failure".into())
    });

    assert_eq!(attempts, 1);
    assert_eq!(registry.active_label().unwrap(), "render-surface-next");
    assert!(registry.activation_plan("next").is_err());
}

#[test]
fn injected_pre_commit_show_failure_keeps_predecessor_active_and_candidate_pending() {
    let bounds = RenderSurfaceBounds::new(10.0, 20.0, 300.0, 200.0).unwrap();
    let manager = RenderSurfaceManager::default();
    manager
        .stage("previous".into(), "render-surface-previous".into(), bounds)
        .unwrap();
    let previous = manager.activation_plan("previous").unwrap();
    manager.commit_activation(&previous).unwrap();
    manager
        .stage(
            "candidate".into(),
            "render-surface-candidate".into(),
            bounds,
        )
        .unwrap();
    let plan = manager.activation_plan("candidate").unwrap();

    let calls = std::cell::RefCell::new(Vec::new());
    let result = prepare_staged_surface_for_activation(
        true,
        || {
            calls.borrow_mut().push("position");
            Ok(())
        },
        || {
            calls.borrow_mut().push("show");
            Err("injected show failure".into())
        },
        || {
            calls.borrow_mut().push("hide");
            Ok(())
        },
    );

    assert_eq!(
        result.unwrap_err(),
        "Failed to show staged render surface: injected show failure"
    );
    assert_eq!(calls.into_inner(), ["position", "show"]);
    assert_eq!(manager.active_label().unwrap(), "render-surface-previous");
    assert_eq!(
        manager.route_label(Some("candidate")).unwrap(),
        "render-surface-candidate"
    );
    assert_eq!(manager.activation_plan("candidate").unwrap(), plan);
    assert!(manager.rollback_pending_surface(&plan.next).unwrap());
    assert!(manager.route_label(Some("candidate")).is_err());
    assert_eq!(manager.active_label().unwrap(), "render-surface-previous");
}

#[test]
fn missing_native_active_surface_releases_authority_and_reports_one_fatal_event() {
    let manager = RenderSurfaceManager::default();
    let active = SurfaceResource {
        session_id: "active".into(),
        label: "render-surface-active".into(),
        target_bounds: RenderSurfaceBounds::new(10.0, 20.0, 300.0, 200.0).unwrap(),
    };
    manager
        .stage(
            active.session_id.clone(),
            active.label.clone(),
            active.target_bounds,
        )
        .unwrap();
    let plan = manager.activation_plan("active").unwrap();
    manager.commit_activation(&plan).unwrap();
    manager
        .stage(
            "pending".into(),
            "render-surface-pending".into(),
            active.target_bounds,
        )
        .unwrap();

    let mut cleanup_sessions = Vec::new();
    let mut emitted = Vec::new();
    handle_missing_active_surface(
        &manager,
        &active,
        |session_id| {
            cleanup_sessions.push(session_id.to_string());
            Err("injected cache delete failure".into())
        },
        |payload| {
            emitted.push(payload);
            Ok(())
        },
    );

    assert!(manager.active_label().is_err());
    assert!(manager.route_label(Some("active")).is_err());
    assert_eq!(
        manager.route_label(Some("pending")).unwrap(),
        "render-surface-pending"
    );
    assert_eq!(cleanup_sessions, ["active"]);
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0]["sessionId"], "active");
    assert_eq!(emitted[0]["phase"], "native-loss");
    assert_eq!(emitted[0]["recoverable"], false);

    // A repeated command now observes no active authority, so the missing
    // child cannot emit another fatal event through this cleanup seam.
    assert!(manager.active_surface().unwrap().is_none());
}
