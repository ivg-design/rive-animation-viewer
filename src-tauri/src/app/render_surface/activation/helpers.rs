use crate::app::render_surface::{geometry::RenderSurfaceBounds, registry::SurfaceResource};

pub(crate) fn prepare_staged_surface_for_activation<Position, Show, Hide>(
    reveal: bool,
    position: Position,
    show: Show,
    hide: Hide,
) -> Result<(), String>
where
    Position: FnOnce() -> Result<(), String>,
    Show: FnOnce() -> Result<(), String>,
    Hide: FnOnce() -> Result<(), String>,
{
    position().map_err(|error| format!("Failed to position staged render surface: {error}"))?;
    if reveal {
        show().map_err(|error| format!("Failed to show staged render surface: {error}"))
    } else {
        hide().map_err(|error| format!("Failed to hide staged render surface: {error}"))
    }
}

pub(crate) fn converge_committed_bounds<F>(
    activated: &SurfaceResource,
    planned: &SurfaceResource,
    set_bounds: F,
) where
    F: FnOnce(RenderSurfaceBounds) -> Result<(), String>,
{
    if activated.target_bounds == planned.target_bounds {
        return;
    }
    if let Err(error) = set_bounds(activated.target_bounds) {
        eprintln!("[rav-app] Render surface activated; deferred bounds convergence: {error}");
    }
}
