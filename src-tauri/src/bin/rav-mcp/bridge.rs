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

fn build_client_presence_payload(state: &BridgeState) -> String {
    json!({
        "bridgeEvent": "mcp-client-state",
        "clientCount": state.client_senders.len(),
        "connected": !state.client_senders.is_empty(),
    })
    .to_string()
}

fn selected_app_connection_id(state: &BridgeState) -> Option<u64> {
    state
        .app_peers
        .iter()
        .max_by_key(|(connection_id, peer)| (peer.kind, *connection_id))
        .map(|(connection_id, _)| *connection_id)
}

fn selected_app_sender(state: &BridgeState) -> Option<(u64, mpsc::UnboundedSender<String>)> {
    let connection_id = selected_app_connection_id(state)?;
    state
        .app_peers
        .get(&connection_id)
        .map(|peer| (connection_id, peer.sender.clone()))
}

fn queue_client_presence_updates(
    state: &BridgeState,
    outgoing: &mut Vec<(mpsc::UnboundedSender<String>, String)>,
) {
    let payload = build_client_presence_payload(state);
    outgoing.extend(
        state
            .app_peers
            .values()
            .map(|peer| (peer.sender.clone(), payload.clone())),
    );
}

fn reject_pending_client_requests(
    state: &mut BridgeState,
    outgoing: &mut Vec<(mpsc::UnboundedSender<String>, String)>,
    message: &str,
) {
    let drained_pending: Vec<(String, PendingClientRequest)> =
        state.pending_client_requests.drain().collect();
    for (request_id, pending) in drained_pending {
        if let Some(client_sender) = state.client_senders.get(&pending.client_id).cloned() {
            outgoing.push((
                client_sender,
                json!({ "id": request_id, "error": message }).to_string(),
            ));
        }
    }
}

fn reject_pending_requests_for_app(
    state: &mut BridgeState,
    outgoing: &mut Vec<(mpsc::UnboundedSender<String>, String)>,
    app_connection_id: u64,
    message: &str,
) {
    let request_ids: Vec<String> = state
        .pending_client_requests
        .iter()
        .filter(|(_, pending)| pending.app_connection_id == app_connection_id)
        .map(|(request_id, _)| request_id.clone())
        .collect();
    for request_id in request_ids {
        let Some(pending) = state.pending_client_requests.remove(&request_id) else {
            continue;
        };
        if let Some(client_sender) = state.client_senders.get(&pending.client_id).cloned() {
            outgoing.push((
                client_sender,
                json!({ "id": request_id, "error": message }).to_string(),
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn receive_command(receiver: &mut mpsc::UnboundedReceiver<String>) -> Value {
        loop {
            let payload = timeout(Duration::from_millis(100), receiver.recv())
                .await
                .expect("bridge payload should arrive")
                .expect("bridge sender should stay connected");
            let value: Value = serde_json::from_str(&payload).expect("valid bridge payload");
            if value.get("command").is_some() {
                return value;
            }
        }
    }

    fn assert_no_command(receiver: &mut mpsc::UnboundedReceiver<String>) {
        while let Ok(payload) = receiver.try_recv() {
            let value: Value = serde_json::from_str(&payload).expect("valid bridge payload");
            assert!(
                value.get("command").is_none(),
                "non-authoritative app must not receive an MCP command: {value}"
            );
        }
    }

    #[test]
    fn app_selection_prioritizes_desktop_then_legacy_then_browser() {
        let mut state = BridgeState::default();
        let (browser, _) = mpsc::unbounded_channel();
        state.app_peers.insert(
            1,
            AppPeer {
                kind: AppPeerKind::Browser,
                sender: browser,
            },
        );
        assert_eq!(selected_app_connection_id(&state), Some(1));

        let (legacy, _) = mpsc::unbounded_channel();
        state.app_peers.insert(
            2,
            AppPeer {
                kind: AppPeerKind::Legacy,
                sender: legacy,
            },
        );
        assert_eq!(selected_app_connection_id(&state), Some(2));

        let (desktop, _) = mpsc::unbounded_channel();
        state.app_peers.insert(
            3,
            AppPeer {
                kind: AppPeerKind::Desktop,
                sender: desktop,
            },
        );
        assert_eq!(selected_app_connection_id(&state), Some(3));
    }

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

        let result = command_task
            .await
            .expect("task result")
            .expect("command result");
        assert_eq!(result.get("ok"), Some(&Value::Bool(true)));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn desktop_peer_is_authoritative_over_browser_peer() {
        let bridge = Bridge::new(Duration::from_millis(500));
        let (browser_tx, mut browser_rx) = mpsc::unbounded_channel();
        let browser_id = bridge
            .register_bridge_peer(BridgePeerRole::App(AppPeerKind::Browser), browser_tx)
            .await;
        let (client_tx, mut client_rx) = mpsc::unbounded_channel();
        let client_id = bridge
            .register_bridge_peer(BridgePeerRole::Client, client_tx)
            .await;

        bridge
            .relay_client_request(
                client_id,
                json!({
                    "id": "browser-only",
                    "command": "rav_status",
                    "params": {}
                }),
            )
            .await
            .expect("browser fallback request");
        assert_eq!(
            receive_command(&mut browser_rx).await.get("id"),
            Some(&Value::String("browser-only".into()))
        );
        bridge
            .relay_app_response(
                browser_id,
                json!({
                    "id": "browser-only",
                    "result": { "build": "browser" }
                }),
            )
            .await;
        let browser_result: Value = serde_json::from_str(
            &timeout(Duration::from_millis(100), client_rx.recv())
                .await
                .expect("browser response")
                .expect("client should stay connected"),
        )
        .expect("valid client response");
        assert_eq!(browser_result["result"]["build"], "browser");

        let (desktop_tx, mut desktop_rx) = mpsc::unbounded_channel();
        let desktop_id = bridge
            .register_bridge_peer(BridgePeerRole::App(AppPeerKind::Desktop), desktop_tx)
            .await;
        bridge
            .relay_client_request(
                client_id,
                json!({
                    "id": "desktop-preferred",
                    "command": "rav_status",
                    "params": {}
                }),
            )
            .await
            .expect("desktop request");
        assert_eq!(
            receive_command(&mut desktop_rx).await.get("id"),
            Some(&Value::String("desktop-preferred".into()))
        );
        assert_no_command(&mut browser_rx);
        bridge
            .relay_app_response(
                desktop_id,
                json!({
                    "id": "desktop-preferred",
                    "result": { "build": "desktop" }
                }),
            )
            .await;
        let desktop_result: Value = serde_json::from_str(
            &timeout(Duration::from_millis(100), client_rx.recv())
                .await
                .expect("desktop response")
                .expect("client should stay connected"),
        )
        .expect("valid client response");
        assert_eq!(desktop_result["result"]["build"], "desktop");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn stale_browser_response_cannot_satisfy_request_after_desktop_replacement() {
        let bridge = Bridge::new(Duration::from_millis(500));
        let (browser_tx, mut browser_rx) = mpsc::unbounded_channel();
        let browser_id = bridge
            .register_bridge_peer(BridgePeerRole::App(AppPeerKind::Browser), browser_tx)
            .await;
        let (client_tx, mut client_rx) = mpsc::unbounded_channel();
        let client_id = bridge
            .register_bridge_peer(BridgePeerRole::Client, client_tx)
            .await;

        bridge
            .relay_client_request(
                client_id,
                json!({
                    "id": "stale-browser-request",
                    "command": "rav_status",
                    "params": {}
                }),
            )
            .await
            .expect("browser request");
        receive_command(&mut browser_rx).await;

        let (desktop_tx, mut desktop_rx) = mpsc::unbounded_channel();
        let desktop_id = bridge
            .register_bridge_peer(BridgePeerRole::App(AppPeerKind::Desktop), desktop_tx)
            .await;
        let replacement_error: Value = serde_json::from_str(
            &timeout(Duration::from_millis(100), client_rx.recv())
                .await
                .expect("replacement should reject in-flight request")
                .expect("client should stay connected"),
        )
        .expect("valid replacement error");
        assert_eq!(replacement_error["id"], "stale-browser-request");
        assert_eq!(replacement_error["error"], "RAV connection changed");

        bridge
            .relay_app_response(
                browser_id,
                json!({
                    "id": "stale-browser-request",
                    "result": { "build": "browser" }
                }),
            )
            .await;

        bridge
            .relay_client_request(
                client_id,
                json!({
                    "id": "desktop-request",
                    "command": "rav_status",
                    "params": {}
                }),
            )
            .await
            .expect("desktop request");
        receive_command(&mut desktop_rx).await;
        bridge
            .relay_app_response(
                browser_id,
                json!({
                    "id": "desktop-request",
                    "result": { "build": "stale-browser" }
                }),
            )
            .await;
        assert!(
            client_rx.try_recv().is_err(),
            "stale browser response must be ignored"
        );
        bridge
            .relay_app_response(
                desktop_id,
                json!({
                    "id": "desktop-request",
                    "result": { "build": "desktop" }
                }),
            )
            .await;
        let desktop_result: Value = serde_json::from_str(
            &timeout(Duration::from_millis(100), client_rx.recv())
                .await
                .expect("desktop response")
                .expect("client should stay connected"),
        )
        .expect("valid desktop response");
        assert_eq!(desktop_result["result"]["build"], "desktop");
    }
}
