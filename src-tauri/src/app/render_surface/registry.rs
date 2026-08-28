use std::{collections::HashMap, sync::Mutex};

use super::geometry::RenderSurfaceBounds;

const REGISTRY_LOCK_ERROR: &str = "Render surface registry lock is poisoned";

#[derive(Clone, Debug, PartialEq)]
pub(super) struct ActivationPlan {
    pub(super) next: SurfaceResource,
    pub(super) previous: Option<SurfaceResource>,
}

/// The native WebView label and the only cache filename it is ever allowed to
/// retire. Keeping those two identifiers together prevents a close failure
/// from orphaning a generated HTML document, or a retry from deleting an
/// unrelated cache entry.
#[derive(Clone, Debug)]
pub(super) struct SurfaceResource {
    pub(super) session_id: String,
    pub(super) label: String,
    pub(super) target_bounds: RenderSurfaceBounds,
}

// Geometry is mutable presentation state. Resource identity remains the stable
// session/label pair so bounds updates cannot prevent cleanup from releasing a
// surface created under its earlier geometry.
impl PartialEq for SurfaceResource {
    fn eq(&self, other: &Self) -> bool {
        self.session_id == other.session_id && self.label == other.label
    }
}

impl Eq for SurfaceResource {}

#[derive(Clone, Debug, PartialEq)]
pub(super) struct SurfaceGeometry {
    pub(super) resource: SurfaceResource,
    pub(super) staged: bool,
}

#[derive(Default)]
pub(super) struct RenderSurfaceRegistry {
    active: Option<SurfaceResource>,
    pending_by_session: HashMap<String, SurfaceResource>,
    retired: Vec<SurfaceResource>,
    cache_retry_sessions: Vec<String>,
}

impl RenderSurfaceRegistry {
    pub(super) fn stage(
        &mut self,
        session_id: String,
        label: String,
        target_bounds: RenderSurfaceBounds,
    ) {
        self.pending_by_session.insert(
            session_id.clone(),
            SurfaceResource {
                session_id,
                label,
                target_bounds,
            },
        );
    }

    pub(super) fn active_label(&self) -> Result<String, String> {
        self.active
            .as_ref()
            .map(|surface| surface.label.clone())
            .ok_or_else(|| "Render surface has not been activated".to_string())
    }

    pub(super) fn active_surface(&self) -> Option<SurfaceResource> {
        self.active.clone()
    }

    #[cfg(test)]
    fn managed_labels(&self) -> Vec<String> {
        self.managed_surfaces()
            .into_iter()
            .map(|surface| surface.label)
            .collect()
    }

    fn managed_surfaces(&self) -> Vec<SurfaceResource> {
        let mut surfaces = Vec::new();
        for surface in self
            .active
            .iter()
            .chain(self.pending_by_session.values())
            .chain(self.retired.iter())
        {
            if !surfaces
                .iter()
                .any(|existing: &SurfaceResource| existing.label == surface.label)
            {
                surfaces.push(surface.clone());
            }
        }
        surfaces
    }

    pub(super) fn activation_plan(&self, session_id: &str) -> Result<ActivationPlan, String> {
        let next = self
            .pending_by_session
            .get(session_id)
            .cloned()
            .ok_or_else(|| format!("No staged render surface for session {session_id}"))?;
        Ok(ActivationPlan {
            next,
            previous: self.active.clone(),
        })
    }

    pub(super) fn commit_activation(
        &mut self,
        plan: &ActivationPlan,
    ) -> Result<SurfaceResource, String> {
        let staged = self.pending_by_session.get(&plan.next.session_id);
        if staged != Some(&plan.next) {
            return Err(format!(
                "Staged render surface changed for session {}",
                plan.next.session_id
            ));
        }
        if self.active != plan.previous {
            return Err(format!(
                "Active render surface changed before session {} could activate",
                plan.next.session_id
            ));
        }
        // Geometry is mutable presentation state. A resize can legitimately
        // land between planning and commit, so commit the current staged
        // resource rather than rejecting a valid activation because its
        // bounds changed while it was being painted.
        let activated = staged.cloned().expect("staged resource was checked above");
        if let Some(previous) = plan
            .previous
            .as_ref()
            .filter(|surface| *surface != &activated)
        {
            self.record_retired(previous.clone());
        }
        self.active = Some(activated.clone());
        self.pending_by_session.remove(&plan.next.session_id);
        Ok(activated)
    }

    fn pending_surface(&self, session_id: &str) -> Option<SurfaceResource> {
        self.pending_by_session.get(session_id).cloned()
    }

    /// Removes only the exact candidate that was staged for a new child. A
    /// later candidate for the same session must remain routable if an older
    /// creation transaction fails after its replacement has already staged.
    fn rollback_pending_surface(&mut self, surface: &SurfaceResource) -> bool {
        if self.pending_by_session.get(&surface.session_id) != Some(surface) {
            return false;
        }
        self.pending_by_session.remove(&surface.session_id);
        true
    }

    pub(super) fn apply_bounds(
        &mut self,
        target_bounds: RenderSurfaceBounds,
    ) -> Vec<SurfaceGeometry> {
        if let Some(active) = self.active.as_mut() {
            active.target_bounds = target_bounds;
        }
        for pending in self.pending_by_session.values_mut() {
            pending.target_bounds = target_bounds;
        }
        self.active
            .iter()
            .cloned()
            .map(|resource| SurfaceGeometry {
                resource,
                staged: false,
            })
            .chain(
                self.pending_by_session
                    .values()
                    .cloned()
                    .map(|resource| SurfaceGeometry {
                        resource,
                        staged: true,
                    }),
            )
            .collect()
    }

    fn release_surface(&mut self, surface: &SurfaceResource) {
        // Native WebViews are owned by label. A defensive duplicate-label
        // registry entry can exist after an interrupted replacement, even
        // though only one native child exists. Closing that child must retire
        // every matching identity so shutdown cannot leave stale routing
        // state behind merely because managed_surfaces deduplicated the label.
        if self
            .active
            .as_ref()
            .is_some_and(|active| active.label == surface.label)
        {
            self.active = None;
        }
        self.pending_by_session
            .retain(|_, pending| pending.label != surface.label);
        self.retired
            .retain(|retired| retired.label != surface.label);
    }

    #[cfg(test)]
    fn clear(&mut self) {
        self.active = None;
        self.pending_by_session.clear();
        self.retired.clear();
        self.cache_retry_sessions.clear();
    }

    fn record_retired(&mut self, surface: SurfaceResource) {
        if !self.retired.contains(&surface) {
            self.retired.push(surface);
        }
    }

    fn record_cache_retry(&mut self, session_id: String) {
        if !self.cache_retry_sessions.contains(&session_id) {
            self.cache_retry_sessions.push(session_id);
        }
    }

    fn cache_retry_sessions(&self) -> Vec<String> {
        self.cache_retry_sessions.clone()
    }

    fn release_cache_retry(&mut self, session_id: &str) {
        self.cache_retry_sessions
            .retain(|pending| pending != session_id);
    }

    fn route_label(&self, requested_session: Option<&str>) -> Result<String, String> {
        if let Some(session_id) = requested_session {
            if let Some(label) = self.pending_by_session.get(session_id) {
                return Ok(label.label.clone());
            }
            if self
                .active
                .as_ref()
                .map(|surface| surface.session_id.as_str())
                == Some(session_id)
            {
                return self.active_label();
            }
            return Err(format!("Unknown render surface session {session_id}"));
        }
        self.active_label()
    }
}

/// Native playback surfaces are double-buffered during navigation. The active
/// WebView remains visible until its replacement has loaded and rendered, so a
/// file/artboard/playback transition never exposes a blank native layer.
#[derive(Default)]
pub struct RenderSurfaceManager(Mutex<RenderSurfaceRegistry>);

impl RenderSurfaceManager {
    pub(super) fn stage(
        &self,
        session_id: String,
        label: String,
        target_bounds: RenderSurfaceBounds,
    ) -> Result<(), String> {
        self.lock()?.stage(session_id, label, target_bounds);
        Ok(())
    }

    pub(super) fn active_label(&self) -> Result<String, String> {
        self.lock()?.active_label()
    }

    pub(super) fn active_surface(&self) -> Result<Option<SurfaceResource>, String> {
        Ok(self.lock()?.active_surface())
    }

    pub(super) fn managed_surfaces(&self) -> Result<Vec<SurfaceResource>, String> {
        Ok(self.lock()?.managed_surfaces())
    }

    pub(super) fn activation_plan(&self, session_id: &str) -> Result<ActivationPlan, String> {
        self.lock()?.activation_plan(session_id)
    }

    pub(super) fn commit_activation(
        &self,
        plan: &ActivationPlan,
    ) -> Result<SurfaceResource, String> {
        self.lock()?.commit_activation(plan)
    }

    pub(super) fn pending_surface(
        &self,
        session_id: &str,
    ) -> Result<Option<SurfaceResource>, String> {
        Ok(self.lock()?.pending_surface(session_id))
    }

    pub(super) fn rollback_pending_surface(
        &self,
        surface: &SurfaceResource,
    ) -> Result<bool, String> {
        Ok(self.lock()?.rollback_pending_surface(surface))
    }

    pub(super) fn apply_bounds(
        &self,
        target_bounds: RenderSurfaceBounds,
    ) -> Result<Vec<SurfaceGeometry>, String> {
        Ok(self.lock()?.apply_bounds(target_bounds))
    }

    pub(super) fn release_surface(&self, surface: &SurfaceResource) -> Result<(), String> {
        self.lock()?.release_surface(surface);
        Ok(())
    }

    pub(super) fn record_retired(&self, surface: SurfaceResource) -> Result<(), String> {
        self.lock()?.record_retired(surface);
        Ok(())
    }

    pub(super) fn record_cache_retry(&self, session_id: String) -> Result<(), String> {
        self.lock()?.record_cache_retry(session_id);
        Ok(())
    }

    pub(super) fn cache_retry_sessions(&self) -> Result<Vec<String>, String> {
        Ok(self.lock()?.cache_retry_sessions())
    }

    pub(super) fn release_cache_retry(&self, session_id: &str) -> Result<(), String> {
        self.lock()?.release_cache_retry(session_id);
        Ok(())
    }

    pub(super) fn route_label(&self, requested_session: Option<&str>) -> Result<String, String> {
        self.lock()?.route_label(requested_session)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, RenderSurfaceRegistry>, String> {
        self.0.lock().map_err(|_| REGISTRY_LOCK_ERROR.to_string())
    }
}

#[cfg(test)]
#[path = "registry_tests.rs"]
mod tests;
