use serde::{Deserialize, Serialize};
use tauri::{LogicalPosition, LogicalSize, Position, Rect, Size};

pub(super) const UI_OVERLAY_PROTOCOL_VERSION: u8 = 1;
pub(super) const UI_OVERLAY_LABEL_PREFIX: &str = "ui-overlay-";
pub(super) const UI_OVERLAY_MAX_STATE_BYTES: usize = 4 * 1024 * 1024;
pub(super) const UI_OVERLAY_MAX_ACTION_BYTES: usize = 64 * 1024;
pub(super) const UI_OVERLAY_MAX_ACTION_ID_BYTES: usize = 64;
pub(super) const UI_OVERLAY_MAX_ACTION_MESSAGE_BYTES: usize = 4 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiOverlayBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

impl UiOverlayBounds {
    pub(super) fn validate(self) -> Result<Self, String> {
        if !self.x.is_finite()
            || !self.y.is_finite()
            || !self.width.is_finite()
            || !self.height.is_finite()
        {
            return Err("UI overlay bounds must contain finite numbers".to_string());
        }
        if self.width <= 0.0 || self.height <= 0.0 {
            return Err("UI overlay width and height must be greater than zero".to_string());
        }
        Ok(self)
    }

    pub(super) fn position(self) -> LogicalPosition<f64> {
        LogicalPosition::new(self.x, self.y)
    }

    pub(super) fn size(self) -> LogicalSize<f64> {
        LogicalSize::new(self.width, self.height)
    }

    pub(super) fn rect(self) -> Rect {
        Rect {
            position: Position::Logical(self.position()),
            size: Size::Logical(self.size()),
        }
    }

    pub(super) fn staged(self) -> Self {
        Self {
            x: -(self.width + 1.0),
            ..self
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowUiOverlayRequest {
    pub purpose: String,
    pub bounds: UiOverlayBounds,
    /// Per-open, main-generated capability token. This prevents stale or
    /// unrelated main-window event listeners from acting on overlay events.
    pub request_token: String,
    #[serde(default)]
    pub state: serde_json::Value,
    #[serde(default)]
    /// Retained for wire compatibility. Native presentation no longer focuses
    /// a child; the child decides whether to focus after its presented receipt.
    #[allow(dead_code)]
    pub focus: bool,
}

impl ShowUiOverlayRequest {
    pub(super) fn validate(mut self) -> Result<Self, String> {
        if !matches!(
            self.purpose.as_str(),
            "settings" | "about" | "mcp" | "export"
        ) {
            return Err(format!("Unsupported UI overlay purpose: {}", self.purpose));
        }
        self.bounds = self.bounds.validate()?;
        let token_is_safe = self.request_token.len() >= 22
            && self.request_token.len() <= 128
            && self
                .request_token
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'));
        if !token_is_safe {
            return Err(
                "UI overlay request token must be an unguessable bounded token".to_string(),
            );
        }
        if !self.state.is_object() {
            return Err("UI overlay state must be an object".to_string());
        }
        let state_len = serde_json::to_vec(&self.state)
            .map_err(|error| format!("Failed to serialize UI overlay state: {error}"))?
            .len();
        if state_len > UI_OVERLAY_MAX_STATE_BYTES {
            return Err("UI overlay state exceeds the bounded payload size".to_string());
        }
        Ok(self)
    }
}

#[derive(Clone, Debug)]
pub(super) struct UiOverlayResource {
    pub epoch: u64,
    pub label: String,
    pub request: ShowUiOverlayRequest,
}

impl UiOverlayResource {
    pub(super) fn bootstrap(&self) -> serde_json::Value {
        serde_json::json!({
            "epoch": self.epoch,
            "protocolVersion": UI_OVERLAY_PROTOCOL_VERSION,
            "purpose": self.request.purpose,
            "requestToken": self.request.request_token,
            "state": self.request.state,
        })
    }
}

/// A deliberately small, typed intent channel from the opaque UI-overlay
/// child back to the trusted main WebView.  The child never receives general
/// event-emission permission: native code verifies its identity first.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiOverlayActionRequest {
    pub epoch: u64,
    pub action_id: String,
    pub purpose: String,
    pub action: String,
    #[serde(default)]
    pub value: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiOverlayReadyRequest {
    pub epoch: u64,
    pub purpose: String,
}

/// A receipt from the trusted main WebView after it has applied a forwarded
/// overlay action.  The child overlay cannot invoke this command.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiOverlayActionCompletionRequest {
    pub epoch: u64,
    pub action_id: String,
    pub ok: bool,
    pub message: String,
}

impl UiOverlayActionRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.epoch == 0
            || !is_bounded_action_id(&self.action_id)
            || self.purpose.is_empty()
            || self.action.is_empty()
        {
            return Err("UI overlay action is missing its identity".to_string());
        }
        if self.action.len() > 64 || self.purpose.len() > 32 {
            return Err("UI overlay action exceeds the bounded identifier size".to_string());
        }
        if serde_json::to_vec(&self.value)
            .map_err(|error| format!("Failed to serialize UI overlay action: {error}"))?
            .len()
            > UI_OVERLAY_MAX_ACTION_BYTES
        {
            return Err("UI overlay action exceeds the bounded payload size".to_string());
        }
        let valid = match (self.purpose.as_str(), self.action.as_str()) {
            (_, "focus-target") => is_bounded_text(&self.value, 128),
            (
                "settings",
                "close" | "about" | "canvas-transparent" | "canvas-lock" | "telemetry-toggle",
            ) => self.value.is_null(),
            ("settings", "runtime-select" | "runtime-custom-apply") => {
                is_bounded_text(&self.value, 128)
            }
            ("settings", "runtime-custom-draft") => is_bounded_text_allow_empty(&self.value, 128),
            ("settings", "canvas-color") => is_hex_color(&self.value),
            ("settings", "canvas-mode") => is_one_of(&self.value, &["auto", "fixed"]),
            ("settings", "canvas-width" | "canvas-height") => {
                is_integer_string_in_range(&self.value, 1, 8192)
            }
            ("settings", "canvas-width-draft" | "canvas-height-draft") => {
                is_empty_or_integer_string_in_range(&self.value, 1, 8192)
            }
            ("about", "close") => self.value.is_null(),
            ("about", "open-link") => is_bounded_text(&self.value, 2048),
            ("mcp", "close" | "script-access-toggle") => self.value.is_null(),
            ("mcp", "port-apply") => is_integer_string_in_range(&self.value, 1, 65535),
            ("mcp", "port-draft") => is_empty_or_integer_string_in_range(&self.value, 1, 65535),
            ("mcp", "client-install" | "client-remove") => {
                is_one_of(&self.value, &["codex", "claude-code", "claude-desktop"])
            }
            ("mcp", "copy") => is_one_of(
                &self.value,
                &[
                    "codex",
                    "claude-code",
                    "claude-desktop",
                    "generic",
                    "server-path",
                ],
            ),
            ("export", "close" | "generate-preview" | "copy-preview" | "export") => {
                self.value.is_null()
            }
            ("export", "branch-expanded") => is_key_boolean_object(&self.value, "key", "expanded"),
            ("export", "selection-toggle") => is_key_boolean_object(&self.value, "key", "selected"),
            ("export", "branch-selection") => {
                is_key_boolean_object(&self.value, "branchKey", "selected")
            }
            ("export", "selection-preset") => is_one_of(&self.value, &["changed", "all", "none"]),
            ("export", "package-source") => is_one_of(&self.value, &["cdn", "local"]),
            ("export", "snippet-mode") => is_one_of(&self.value, &["compact", "scaffold"]),
            ("export", "tree-scroll") => is_nonnegative_integer(&self.value, 10_000_000),
            _ => false,
        };
        valid
            .then_some(())
            .ok_or_else(|| "Unsupported or invalid UI overlay action".to_string())
    }
}

impl UiOverlayActionCompletionRequest {
    pub(super) fn validate(&self) -> Result<(), String> {
        if self.epoch == 0 || !is_bounded_action_id(&self.action_id) {
            return Err("UI overlay action result is missing its identity".to_string());
        }
        if self.message.len() > UI_OVERLAY_MAX_ACTION_MESSAGE_BYTES {
            return Err("UI overlay action result exceeds the bounded message size".to_string());
        }
        Ok(())
    }
}

fn is_bounded_action_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= UI_OVERLAY_MAX_ACTION_ID_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn is_bounded_text(value: &serde_json::Value, max_len: usize) -> bool {
    value.as_str().is_some_and(|text| {
        !text.is_empty() && text.len() <= max_len && !text.chars().any(char::is_control)
    })
}

fn is_bounded_text_allow_empty(value: &serde_json::Value, max_len: usize) -> bool {
    value
        .as_str()
        .is_some_and(|text| text.len() <= max_len && !text.chars().any(char::is_control))
}

fn is_one_of(value: &serde_json::Value, allowed: &[&str]) -> bool {
    value
        .as_str()
        .is_some_and(|candidate| allowed.contains(&candidate))
}

fn is_hex_color(value: &serde_json::Value) -> bool {
    value.as_str().is_some_and(|text| {
        text.len() == 7
            && text.starts_with('#')
            && text[1..].bytes().all(|byte| byte.is_ascii_hexdigit())
    })
}

fn is_integer_string_in_range(value: &serde_json::Value, minimum: u32, maximum: u32) -> bool {
    let Some(text) = value.as_str() else {
        return false;
    };
    if text.is_empty() || text.len() > 5 || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    text.parse::<u32>()
        .is_ok_and(|number| (minimum..=maximum).contains(&number))
}

fn is_empty_or_integer_string_in_range(
    value: &serde_json::Value,
    minimum: u32,
    maximum: u32,
) -> bool {
    value.as_str() == Some("") || is_integer_string_in_range(value, minimum, maximum)
}

fn is_nonnegative_integer(value: &serde_json::Value, maximum: u64) -> bool {
    value.as_u64().is_some_and(|number| number <= maximum)
}

fn is_key_boolean_object(value: &serde_json::Value, key_name: &str, flag_name: &str) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.len() == 2
        && object
            .get(key_name)
            .is_some_and(|key| is_bounded_text(key, 16 * 1024))
        && object
            .get(flag_name)
            .is_some_and(serde_json::Value::is_boolean)
}

#[cfg(test)]
#[path = "types_tests.rs"]
mod tests;
