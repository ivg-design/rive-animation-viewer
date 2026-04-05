use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::timeout;
use uuid::Uuid;

use crate::support::constants::APP_CONNECTION_GRACE_MS;
use crate::websocket::BridgePeerRole;

#[derive(Default)]
struct BridgeState {
    sender: Option<mpsc::UnboundedSender<String>>,
    pending: HashMap<String, oneshot::Sender<Result<Value, String>>>,
    active_connection_id: u64,
    next_connection_id: u64,
    app_sender: Option<mpsc::UnboundedSender<String>>,
    app_connection_id: Option<u64>,
    client_senders: HashMap<u64, mpsc::UnboundedSender<String>>,
    pending_client_requests: HashMap<String, u64>,
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
                        pending_tx.take().expect("pending sender should exist until dispatch"),
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

        match timeout(self.command_timeout, rx).await {
            Ok(Ok(Ok(result))) => Ok(result),
            Ok(Ok(Err(message))) => Err(anyhow!(message)),
            Ok(Err(_)) => Err(anyhow!("RAV request channel closed unexpectedly")),
            Err(_) => {
                let mut state = self.inner.lock().await;
                state.pending.remove(&request_id);
                Err(anyhow!(
                    "Command \"{}\" timed out after {}ms",
                    command,
                    self.command_timeout.as_millis()
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
            state.next_connection_id += 1;
            let connection_id = state.next_connection_id;
            match role {
                BridgePeerRole::App => {
                    state.app_connection_id = Some(connection_id);
                    state.app_sender = Some(sender);
                    if let Some(app_sender) = state.app_sender.clone() {
                        outgoing.push((app_sender, build_client_presence_payload(&state)));
                    }
                    let drained_pending: Vec<(String, u64)> =
                        state.pending_client_requests.drain().collect();
                    for (request_id, client_id) in drained_pending {
                        if let Some(client_sender) = state.client_senders.get(&client_id).cloned() {
                            outgoing.push((
                                client_sender,
                                json!({ "id": request_id, "error": "RAV reconnected" }).to_string(),
                            ));
                        }
                    }
                }
                BridgePeerRole::Client => {
                    state.client_senders.insert(connection_id, sender);
                    if let Some(app_sender) = state.app_sender.clone() {
                        outgoing.push((app_sender, build_client_presence_payload(&state)));
                    }
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
                let sender = state.app_sender.clone();
                if sender.is_some() {
                    state.pending_client_requests.insert(request_id.clone(), client_id);
                }
                sender
            };
            if let Some(sender) = maybe_sender {
                break sender;
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(anyhow!(
                    "RAV is not connected. Make sure the app is running and MCP is enabled."
                ));
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        };

        sender
            .send(message.to_string())
            .map_err(|_| anyhow!("RAV bridge is unavailable"))?;
        Ok(())
    }

    pub async fn relay_app_response(&self, message: Value) {
        let Some(request_id) = message.get("id").and_then(Value::as_str).map(str::to_owned) else {
            return;
        };

        let client_sender = {
            let mut state = self.inner.lock().await;
            let Some(client_id) = state.pending_client_requests.remove(&request_id) else {
                return;
            };
            state.client_senders.get(&client_id).cloned()
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
                BridgePeerRole::App => {
                    if state.app_connection_id != Some(connection_id) {
                        return;
                    }
                    state.app_connection_id = None;
                    state.app_sender = None;
                    let drained_pending: Vec<(String, u64)> =
                        state.pending_client_requests.drain().collect();
                    for (request_id, client_id) in drained_pending {
                        if let Some(client_sender) = state.client_senders.get(&client_id).cloned() {
                            outgoing.push((
                                client_sender,
                                json!({ "id": request_id, "error": message.clone() }).to_string(),
                            ));
                        }
                    }
                }
                BridgePeerRole::Client => {
                    state.client_senders.remove(&connection_id);
                    state
                        .pending_client_requests
                        .retain(|_, client_id| *client_id != connection_id);
                    if let Some(app_sender) = state.app_sender.clone() {
                        outgoing.push((app_sender, build_client_presence_payload(&state)));
                    }
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

fn build_client_presence_payload(state: &BridgeState) -> String {
    json!({
        "bridgeEvent": "mcp-client-state",
        "clientCount": state.client_senders.len(),
        "connected": !state.client_senders.is_empty(),
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(flavor = "current_thread")]
    async fn send_command_waits_for_bridge_connection_before_failing() {
        let bridge = Bridge::new(Duration::from_millis(500));
        let bridge_for_command = bridge.clone();
        let command_task = tokio::spawn(async move {
            bridge_for_command
                .send_command("rav_status", Value::Null)
                .await
        });

        tokio::time::sleep(Duration::from_millis(80)).await;

        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        bridge.register_connection(tx).await;

        let outbound = rx.recv().await.expect("bridge request");
        let outbound_value: Value = serde_json::from_str(&outbound).expect("valid command json");
        let request_id = outbound_value
            .get("id")
            .and_then(Value::as_str)
            .expect("request id")
            .to_string();

        bridge
            .handle_incoming_message(json!({
                "id": request_id,
                "result": { "ok": true }
            }))
            .await;

        let result = command_task.await.expect("task result").expect("command result");
        assert_eq!(result.get("ok"), Some(&Value::Bool(true)));
    }
}
