use super::{
    ActivationPlan, ActivationWatchdogRetry, ActivationWatchdogTicket, RenderSurfaceManager,
    RenderSurfaceRegistry, SurfaceGeometry, SurfaceResource,
};
use crate::app::render_surface::geometry::RenderSurfaceBounds;

const REGISTRY_LOCK_ERROR: &str = "Render surface registry lock is poisoned";

impl RenderSurfaceManager {
    pub(in crate::app::render_surface) fn stage(
        &self,
        session_id: String,
        label: String,
        target_bounds: RenderSurfaceBounds,
    ) -> Result<(), String> {
        self.lock()?.stage(session_id, label, target_bounds);
        Ok(())
    }

    pub(in crate::app::render_surface) fn active_label(&self) -> Result<String, String> {
        self.lock()?.active_label()
    }

    pub(in crate::app::render_surface) fn arm_activation_watchdog(
        &self,
        session_id: &str,
    ) -> Result<ActivationWatchdogTicket, String> {
        self.lock()?.arm_activation_watchdog(session_id)
    }

    pub(in crate::app::render_surface) fn begin_activation_watchdog_retry(
        &self,
        ticket: &ActivationWatchdogTicket,
        replacement_label: String,
    ) -> Result<Option<ActivationWatchdogRetry>, String> {
        Ok(self
            .lock()?
            .begin_activation_watchdog_retry(ticket, replacement_label))
    }

    pub(in crate::app::render_surface) fn acknowledge_first_frame(
        &self,
        label: &str,
    ) -> Result<Option<SurfaceResource>, String> {
        Ok(self.lock()?.acknowledge_first_frame(label))
    }

    pub(in crate::app::render_surface) fn active_surface(
        &self,
    ) -> Result<Option<SurfaceResource>, String> {
        Ok(self.lock()?.active_surface())
    }

    pub(in crate::app::render_surface) fn managed_surfaces(
        &self,
    ) -> Result<Vec<SurfaceResource>, String> {
        Ok(self.lock()?.managed_surfaces())
    }

    pub(in crate::app::render_surface) fn activation_plan(
        &self,
        session_id: &str,
    ) -> Result<ActivationPlan, String> {
        self.lock()?.activation_plan(session_id)
    }

    pub(in crate::app::render_surface) fn commit_activation(
        &self,
        plan: &ActivationPlan,
    ) -> Result<SurfaceResource, String> {
        self.lock()?.commit_activation(plan)
    }

    pub(in crate::app::render_surface) fn pending_surface(
        &self,
        session_id: &str,
    ) -> Result<Option<SurfaceResource>, String> {
        Ok(self.lock()?.pending_surface(session_id))
    }

    pub(in crate::app::render_surface) fn rollback_pending_surface(
        &self,
        surface: &SurfaceResource,
    ) -> Result<bool, String> {
        Ok(self.lock()?.rollback_pending_surface(surface))
    }

    pub(in crate::app::render_surface) fn apply_bounds(
        &self,
        target_bounds: RenderSurfaceBounds,
    ) -> Result<Vec<SurfaceGeometry>, String> {
        Ok(self.lock()?.apply_bounds(target_bounds))
    }

    pub(in crate::app::render_surface) fn release_surface(
        &self,
        surface: &SurfaceResource,
    ) -> Result<(), String> {
        self.lock()?.release_surface(surface);
        Ok(())
    }

    pub(in crate::app::render_surface) fn record_retired(
        &self,
        surface: SurfaceResource,
    ) -> Result<(), String> {
        self.lock()?.record_retired(surface);
        Ok(())
    }

    pub(in crate::app::render_surface) fn record_cache_retry(
        &self,
        session_id: String,
    ) -> Result<(), String> {
        self.lock()?.record_cache_retry(session_id);
        Ok(())
    }

    pub(in crate::app::render_surface) fn cache_retry_sessions(
        &self,
    ) -> Result<Vec<String>, String> {
        Ok(self.lock()?.cache_retry_sessions())
    }

    pub(in crate::app::render_surface) fn release_cache_retry(
        &self,
        session_id: &str,
    ) -> Result<(), String> {
        self.lock()?.release_cache_retry(session_id);
        Ok(())
    }

    pub(in crate::app::render_surface) fn route_label(
        &self,
        requested_session: Option<&str>,
    ) -> Result<String, String> {
        self.lock()?.route_label(requested_session)
    }

    pub(in crate::app::render_surface) fn routable_surface_for_label(
        &self,
        label: &str,
    ) -> Result<Option<SurfaceResource>, String> {
        Ok(self.lock()?.routable_surface_for_label(label))
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, RenderSurfaceRegistry>, String> {
        self.0.lock().map_err(|_| REGISTRY_LOCK_ERROR.to_string())
    }
}
