use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::timeout;
use uuid::Uuid;

use crate::support::constants::APP_CONNECTION_GRACE_MS;
use crate::websocket::{AppPeerKind, BridgePeerRole};

mod routing;
use routing::{
    queue_client_presence_updates, reject_pending_client_requests, reject_pending_requests_for_app,
    selected_app_connection_id, selected_app_sender,
};

#[derive(Clone)]
struct AppPeer {
    kind: AppPeerKind,
    sender: mpsc::UnboundedSender<String>,
}

#[derive(Clone, Copy)]
struct PendingClientRequest {
    app_connection_id: u64,
    client_id: u64,
}

#[derive(Default)]
struct BridgeState {
    sender: Option<mpsc::UnboundedSender<String>>,
    pending: HashMap<String, oneshot::Sender<Result<Value, String>>>,
    active_connection_id: u64,
    next_connection_id: u64,
    app_peers: HashMap<u64, AppPeer>,
    client_senders: HashMap<u64, mpsc::UnboundedSender<String>>,
    pending_client_requests: HashMap<String, PendingClientRequest>,
}

#[derive(Clone)]
pub struct Bridge {
    inner: Arc<Mutex<BridgeState>>,
    command_timeout: Duration,
}

impl Bridge {
    pub fn new(command_timeout: Duration) -> Self {
        Self {
            inner: Arc::new(Mutex::new(BridgeState::default())),
            command_timeout,
        }
    }

    pub async fn send_command(&self, command: &str, params: Value) -> Result<Value> {
        self.send_command_with_timeout(command, params, self.command_timeout)
            .await
    }

    pub async fn send_command_with_timeout(
        &self,
        command: &str,
        params: Value,
        command_timeout: Duration,
    ) -> Result<Value> {
        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        let payload = json!({
            "id": request_id,
            "command": command,
            "params": params,
        });
        let deadline = tokio::time::Instant::now() + Duration::from_millis(APP_CONNECTION_GRACE_MS);
        let mut pending_tx = Some(tx);

        loop {
            let sender = {
                let state = self.inner.lock().await;
                state.sender.clone()
            };

            if let Some(sender) = sender {
                let send_result = {
                    let mut state = self.inner.lock().await;
                    state.pending.insert(
                        request_id.clone(),
                        pending_tx
                            .take()
                            .expect("pending sender should exist until dispatch"),
                    );
                    let send_result = sender.send(payload.to_string());
                    if send_result.is_err() {
                        pending_tx = state.pending.remove(&request_id);
                    }
                    send_result
                };

                if send_result.is_ok() {
                    break;
                }
            }

            if tokio::time::Instant::now() >= deadline {
                return Err(anyhow!(
                    "RAV is not connected. Make sure the Rive Animation Viewer is running and the MCP bridge is enabled."
                ));
            }

            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        match timeout(command_timeout, rx).await {
            Ok(Ok(Ok(result))) => Ok(result),
            Ok(Ok(Err(message))) => Err(anyhow!(message)),
            Ok(Err(_)) => Err(anyhow!("RAV request channel closed unexpectedly")),
            Err(_) => {
                let mut state = self.inner.lock().await;
                state.pending.remove(&request_id);
                Err(anyhow!(
                    "Command \"{}\" timed out after {}ms",
                    command,
                    command_timeout.as_millis()
                ))
            }
        }
    }

    pub async fn register_connection(&self, sender: mpsc::UnboundedSender<String>) -> u64 {
        let mut state = self.inner.lock().await;
        reject_all_pending(&mut state, "RAV reconnected".into());
        state.next_connection_id += 1;
        state.active_connection_id = state.next_connection_id;
        state.sender = Some(sender);
        state.active_connection_id
    }

    pub async fn handle_incoming_message(&self, message: Value) {
        let Some(request_id) = message.get("id").and_then(Value::as_str).map(str::to_owned) else {
            return;
        };

        let pending = {
            let mut state = self.inner.lock().await;
            state.pending.remove(&request_id)
        };

        let Some(pending) = pending else {
            return;
        };

        if let Some(error) = message.get("error") {
            let error_text = if let Some(text) = error.as_str() {
                text.to_string()
            } else {
                error.to_string()
            };
            let _ = pending.send(Err(error_text));
            return;
        }

        let result = message.get("result").cloned().unwrap_or(Value::Null);
        let _ = pending.send(Ok(result));
    }

    pub async fn handle_disconnect(&self, connection_id: u64, message: String) {
        let mut state = self.inner.lock().await;
        if state.active_connection_id != connection_id {
            return;
        }
        state.sender = None;
        reject_all_pending(&mut state, message);
    }

    pub async fn register_bridge_peer(
        &self,
        role: BridgePeerRole,
        sender: mpsc::UnboundedSender<String>,
    ) -> u64 {
        let mut outgoing = Vec::new();
        let connection_id = {
            let mut state = self.inner.lock().await;
            let previously_selected_app = selected_app_connection_id(&state);
            state.next_connection_id += 1;
            let connection_id = state.next_connection_id;
            match role {
                BridgePeerRole::App(kind) => {
                    state
                        .app_peers
                        .insert(connection_id, AppPeer { kind, sender });
                    if previously_selected_app != selected_app_connection_id(&state) {
                        reject_pending_client_requests(
                            &mut state,
                            &mut outgoing,
                            "RAV connection changed",
                        );
                    }
                    queue_client_presence_updates(&state, &mut outgoing);
                }
                BridgePeerRole::Client => {
                    state.client_senders.insert(connection_id, sender);
                    queue_client_presence_updates(&state, &mut outgoing);
                }
            }
            connection_id
        };

        for (sender, payload) in outgoing {
            let _ = sender.send(payload);
        }

        connection_id
    }

    pub async fn relay_client_request(&self, client_id: u64, message: Value) -> Result<()> {
        let request_id = message
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| anyhow!("Client request is missing an id"))?;
        if message.get("command").and_then(Value::as_str).is_none() {
            return Err(anyhow!("Client request is missing a command"));
        }

        let deadline = tokio::time::Instant::now() + Duration::from_millis(APP_CONNECTION_GRACE_MS);
        let sender = loop {
            let maybe_sender = {
                let mut state = self.inner.lock().await;
                let selected = selected_app_sender(&state);
                if let Some((app_connection_id, _)) = selected.as_ref() {
                    state.pending_client_requests.insert(
                        request_id.clone(),
                        PendingClientRequest {
                            app_connection_id: *app_connection_id,
                            client_id,
                        },
                    );
                }
                selected
            };
            if let Some((app_connection_id, sender)) = maybe_sender {
                break (app_connection_id, sender);
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(anyhow!(
                    "RAV is not connected. Make sure the app is running and MCP is enabled."
                ));
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        };

        let (app_connection_id, sender) = sender;
        if sender.send(message.to_string()).is_err() {
            let mut state = self.inner.lock().await;
            if state
                .pending_client_requests
                .get(&request_id)
                .is_some_and(|pending| pending.app_connection_id == app_connection_id)
            {
                state.pending_client_requests.remove(&request_id);
            }
            return Err(anyhow!("RAV bridge is unavailable"));
        }

        Ok(())
    }

    pub async fn relay_app_response(&self, app_connection_id: u64, message: Value) {
        let Some(request_id) = message.get("id").and_then(Value::as_str).map(str::to_owned) else {
            return;
        };

        let client_sender = {
            let mut state = self.inner.lock().await;
            let Some(pending) = state.pending_client_requests.get(&request_id).copied() else {
                return;
            };
            if pending.app_connection_id != app_connection_id {
                return;
            }
            state.pending_client_requests.remove(&request_id);
            state.client_senders.get(&pending.client_id).cloned()
        };

        if let Some(sender) = client_sender {
            let _ = sender.send(message.to_string());
        }
    }

    pub async fn handle_bridge_disconnect(
        &self,
        connection_id: u64,
        role: BridgePeerRole,
        message: String,
    ) {
        let mut outgoing = Vec::new();
        {
            let mut state = self.inner.lock().await;
            match role {
                BridgePeerRole::App(_) => {
                    if state.app_peers.remove(&connection_id).is_none() {
                        return;
                    }
                    reject_pending_requests_for_app(
                        &mut state,
                        &mut outgoing,
                        connection_id,
                        &message,
                    );
                    queue_client_presence_updates(&state, &mut outgoing);
                }
                BridgePeerRole::Client => {
                    state.client_senders.remove(&connection_id);
                    state
                        .pending_client_requests
                        .retain(|_, pending| pending.client_id != connection_id);
                    queue_client_presence_updates(&state, &mut outgoing);
                }
            }
        }

        for (sender, payload) in outgoing {
            let _ = sender.send(payload);
        }
    }
}

fn reject_all_pending(state: &mut BridgeState, message: String) {
    for (_, pending) in state.pending.drain() {
        let _ = pending.send(Err(message.clone()));
    }
}

#[cfg(test)]
#[path = "bridge/tests.rs"]
mod tests;
