use super::UiOverlayManager;
use crate::app::ui_overlay::types::{UiOverlayBounds, UiOverlayResource};

impl UiOverlayManager {
    pub(in crate::app::ui_overlay) fn update_active_bounds(
        &self,
        epoch: u64,
        bounds: UiOverlayBounds,
    ) -> Result<Option<UiOverlayResource>, String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "UI overlay registry is unavailable")?;
        let Some(active) = registry.active.as_mut().filter(|item| item.epoch == epoch) else {
            return Ok(None);
        };
        active.request.bounds = bounds;
        Ok(Some(active.clone()))
    }
}
