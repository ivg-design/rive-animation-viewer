use std::sync::Mutex;
use tokio::{
    sync::{oneshot, watch},
    time::{timeout, Duration, Instant},
};

use super::types::{
    ShowUiOverlayRequest, UiOverlayResource, UI_OVERLAY_LABEL_PREFIX, UI_OVERLAY_MAX_STATE_BYTES,
};

#[derive(Default)]
struct UiOverlayRegistry {
    active: Option<UiOverlayResource>,
    next_epoch: u64,
    pending: Option<UiOverlayResource>,
    pending_ready: Option<oneshot::Sender<Result<(), String>>>,
    pending_presented: bool,
    /// Resources that have been removed from the active/pending protocol but
    /// whose native child WebViews still need to be closed.  Keeping these
    /// separately makes close failures retryable without resurrecting stale
    /// overlays into the interaction path.
    retiring: Vec<UiOverlayResource>,
}

pub struct UiOverlayManager {
    registry: Mutex<UiOverlayRegistry>,
    changes: watch::Sender<u64>,
}

impl Default for UiOverlayManager {
    fn default() -> Self {
        let (changes, _) = watch::channel(0);
        Self {
            registry: Mutex::new(UiOverlayRegistry::default()),
            changes,
        }
    }
}

impl UiOverlayManager {
    pub(super) fn stage(
        &self,
        request: ShowUiOverlayRequest,
    ) -> Result<(UiOverlayResource, oneshot::Receiver<Result<(), String>>), String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "UI overlay registry is unavailable")?;
        registry.next_epoch = registry.next_epoch.saturating_add(1).max(1);
        let resource = UiOverlayResource {
            epoch: registry.next_epoch,
            label: format!("{UI_OVERLAY_LABEL_PREFIX}{}", registry.next_epoch),
            request,
        };
        if let Some(superseded) = registry.pending.take() {
            Self::retire(&mut registry, superseded);
        }
        if let Some(sender) = registry.pending_ready.take() {
            let _ = sender.send(Err("UI overlay request was superseded".to_string()));
        }
        let (sender, receiver) = oneshot::channel();
        registry.pending = Some(resource.clone());
        registry.pending_ready = Some(sender);
        registry.pending_presented = false;
        let _ = self
            .changes
            .send_modify(|generation| *generation = generation.saturating_add(1));
        Ok((resource, receiver))
    }

    pub(super) fn active(&self) -> Result<Option<UiOverlayResource>, String> {
        self.registry
            .lock()
            .map(|registry| registry.active.clone())
            .map_err(|_| "UI overlay registry is unavailable".to_string())
    }

    /// Claims the single child-ready presentation transition. A repeated ready
    /// command cannot produce a second open event.
    pub(super) fn prepare_pending(
        &self,
        label: &str,
        epoch: u64,
        purpose: &str,
    ) -> Result<Option<UiOverlayResource>, String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "UI overlay registry is unavailable")?;
        let Some(pending) = registry.pending.as_ref().cloned() else {
            return Ok(None);
        };
        if registry.pending_presented
            || pending.label != label
            || pending.epoch != epoch
            || pending.request.purpose != purpose
        {
            return Ok(None);
        }
        registry.pending_presented = true;
        Ok(Some(pending))
    }

    pub(super) fn prepared_pending(
        &self,
        label: &str,
    ) -> Result<Option<UiOverlayResource>, String> {
        self.registry
            .lock()
            .map(|registry| {
                registry
                    .pending
                    .as_ref()
                    .filter(|item| registry.pending_presented && item.label == label)
                    .cloned()
            })
            .map_err(|_| "UI overlay registry is unavailable".to_string())
    }

    /// Promote a page-loaded candidate only after the trusted main WebView has
    /// adopted the emitted epoch.  Until then the previous active overlay is
    /// retained as the visible, actionable overlay.
    pub(super) fn acknowledge_adoption(
        &self,
        label: &str,
    ) -> Result<Option<UiOverlayResource>, String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "UI overlay registry is unavailable")?;
        if !registry.pending_presented
            || registry.pending.as_ref().map(|item| item.label.as_str()) != Some(label)
        {
            return Ok(None);
        }
        let next = registry.pending.take().expect("checked pending overlay");
        registry.pending_presented = false;
        if let Some(previous) = registry.active.replace(next.clone()) {
            Self::retire(&mut registry, previous);
        }
        if let Some(sender) = registry.pending_ready.take() {
            let _ = sender.send(Ok(()));
        }
        let _ = self
            .changes
            .send_modify(|generation| *generation = generation.saturating_add(1));
        Ok(Some(next))
    }

    pub(super) fn reject_pending(&self, label: &str) -> Result<bool, String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "UI overlay registry is unavailable")?;
        if registry.pending.as_ref().map(|item| item.label.as_str()) != Some(label) {
            return Ok(false);
        }
        if let Some(pending) = registry.pending.take() {
            Self::retire(&mut registry, pending);
        }
        registry.pending_presented = false;
        if let Some(sender) = registry.pending_ready.take() {
            let _ = sender.send(Err("UI overlay failed to become ready".to_string()));
        }
        let _ = self
            .changes
            .send_modify(|generation| *generation = generation.saturating_add(1));
        Ok(true)
    }

    /// Resolves a candidate that was prepared for presentation but lost the
    /// final adoption race.  It either moves the still-pending candidate to
    /// retirement or confirms that another transition already did so.  An
    /// active resource with this label is deliberately left alone: it was
    /// successfully adopted by a concurrent acknowledgement.
    pub(super) fn retire_failed_adoption(&self, label: &str) -> Result<bool, String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "UI overlay registry is unavailable")?;
        if registry.pending.as_ref().map(|item| item.label.as_str()) == Some(label) {
            if let Some(pending) = registry.pending.take() {
                Self::retire(&mut registry, pending);
            }
            registry.pending_presented = false;
            if let Some(sender) = registry.pending_ready.take() {
                let _ = sender.send(Err("UI overlay adoption was superseded".to_string()));
            }
            let _ = self
                .changes
                .send_modify(|generation| *generation = generation.saturating_add(1));
            return Ok(true);
        }
        Ok(registry.retiring.iter().any(|item| item.label == label))
    }

    pub(super) fn reject_pending_epoch(&self, epoch: u64) -> Result<bool, String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "UI overlay registry is unavailable")?;
        if registry.pending.as_ref().map(|item| item.epoch) != Some(epoch) {
            return Ok(false);
        }
        if let Some(sender) = registry.pending_ready.take() {
            let _ = sender.send(Err("UI overlay failed to become ready".to_string()));
        }
        registry.pending_presented = false;
        if let Some(pending) = registry.pending.take() {
            Self::retire(&mut registry, pending);
        }
        let _ = self
            .changes
            .send_modify(|generation| *generation = generation.saturating_add(1));
        Ok(true)
    }

    pub(super) fn retire_all(&self) -> Result<(), String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "UI overlay registry is unavailable")?;
        if let Some(sender) = registry.pending_ready.take() {
            let _ = sender.send(Err(
                "UI overlay was closed before it became ready".to_string()
            ));
        }
        registry.pending_presented = false;
        for resource in [registry.pending.take(), registry.active.take()]
            .into_iter()
            .flatten()
        {
            Self::retire(&mut registry, resource);
        }
        let _ = self
            .changes
            .send_modify(|generation| *generation = generation.saturating_add(1));
        Ok(())
    }

    pub(super) fn retire_for_close(&self, expected_epoch: Option<u64>) -> Result<(), String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "UI overlay registry is unavailable")?;
        let current_matches = expected_epoch.is_none_or(|epoch| {
            registry.active.as_ref().map(|item| item.epoch) == Some(epoch)
                || registry.pending.as_ref().map(|item| item.epoch) == Some(epoch)
        });
        let retired_only_match = expected_epoch
            .is_some_and(|epoch| registry.retiring.iter().any(|item| item.epoch == epoch));
        if !current_matches && !retired_only_match {
            return Ok(());
        }
        // A stale close may name a resource whose native close previously
        // failed. Leave a newer active/pending generation intact; callers
        // will retry the retirement snapshot after this method returns.
        if !current_matches {
            return Ok(());
        }
        if let Some(sender) = registry.pending_ready.take() {
            let _ = sender.send(Err(
                "UI overlay was closed before it became ready".to_string()
            ));
        }
        registry.pending_presented = false;
        for resource in [registry.pending.take(), registry.active.take()]
            .into_iter()
            .flatten()
        {
            Self::retire(&mut registry, resource);
        }
        let _ = self
            .changes
            .send_modify(|generation| *generation = generation.saturating_add(1));
        Ok(())
    }

    /// Snapshot close work without removing it. Call `mark_retired_closed`
    /// only after the native close succeeded or the WebView is already gone.
    pub(super) fn retiring(&self) -> Result<Vec<UiOverlayResource>, String> {
        self.registry
            .lock()
            .map(|registry| registry.retiring.clone())
            .map_err(|_| "UI overlay registry is unavailable".to_string())
    }

    pub(super) fn mark_retired_closed(&self, label: &str) -> Result<bool, String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "UI overlay registry is unavailable")?;
        let before = registry.retiring.len();
        registry.retiring.retain(|resource| resource.label != label);
        Ok(registry.retiring.len() != before)
    }

    fn retire(registry: &mut UiOverlayRegistry, resource: UiOverlayResource) {
        if !registry
            .retiring
            .iter()
            .any(|existing| existing.label == resource.label)
        {
            registry.retiring.push(resource);
        }
    }

    pub(super) fn update_active_state(
        &self,
        epoch: u64,
        state_patch: serde_json::Value,
    ) -> Result<Option<UiOverlayResource>, String> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| "UI overlay registry is unavailable")?;
        let Some(active) = registry.active.as_mut().filter(|item| item.epoch == epoch) else {
            return Ok(None);
        };
        let mut merged = active.request.state.clone();
        let current = merged
            .as_object_mut()
            .ok_or_else(|| "Stored UI overlay state is not an object".to_string())?;
        let patch = state_patch
            .as_object()
            .ok_or_else(|| "UI overlay state patch is not an object".to_string())?;
        current.extend(patch.clone());
        if serde_json::to_vec(&merged)
            .map_err(|error| format!("Failed to serialize merged UI overlay state: {error}"))?
            .len()
            > UI_OVERLAY_MAX_STATE_BYTES
        {
            return Err("Merged UI overlay state exceeds the bounded payload size".to_string());
        }
        active.request.state = merged;
        Ok(Some(active.clone()))
    }

    fn has_pending(&self) -> Result<bool, String> {
        self.registry
            .lock()
            .map(|registry| registry.pending.is_some())
            .map_err(|_| "UI overlay registry is unavailable".to_string())
    }

    /// If an initial open is still staging, wait for its adoption/rejection so
    /// a concurrent playback restack cannot silently return `None`.
    pub(super) async fn wait_for_active_or_pending_resolution(
        &self,
        wait_for: Duration,
    ) -> Result<Option<UiOverlayResource>, String> {
        let mut changes = self.changes.subscribe();
        let deadline = Instant::now() + wait_for;
        loop {
            if let Some(active) = self.active()? {
                return Ok(Some(active));
            }
            if !self.has_pending()? {
                return Ok(None);
            }
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or_else(|| "UI overlay pending adoption timed out".to_string())?;
            timeout(remaining, changes.changed())
                .await
                .map_err(|_| "UI overlay pending adoption timed out".to_string())?
                .map_err(|_| "UI overlay change channel closed".to_string())?;
        }
    }
}

#[cfg(test)]
#[path = "manager_tests.rs"]
mod tests;
