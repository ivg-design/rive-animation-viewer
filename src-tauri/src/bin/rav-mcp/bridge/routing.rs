use super::{BridgeState, PendingClientRequest};
use serde_json::json;
use tokio::sync::mpsc;

pub(super) fn selected_app_connection_id(state: &BridgeState) -> Option<u64> {
    state
        .app_peers
        .iter()
        .max_by_key(|(connection_id, peer)| (peer.kind, *connection_id))
        .map(|(connection_id, _)| *connection_id)
}

pub(super) fn selected_app_sender(
    state: &BridgeState,
) -> Option<(u64, mpsc::UnboundedSender<String>)> {
    let connection_id = selected_app_connection_id(state)?;
    state
        .app_peers
        .get(&connection_id)
        .map(|peer| (connection_id, peer.sender.clone()))
}

pub(super) fn queue_client_presence_updates(
    state: &BridgeState,
    outgoing: &mut Vec<(mpsc::UnboundedSender<String>, String)>,
) {
    let payload = json!({
        "bridgeEvent": "mcp-client-state",
        "clientCount": state.client_senders.len(),
        "connected": !state.client_senders.is_empty(),
    })
    .to_string();
    outgoing.extend(
        state
            .app_peers
            .values()
            .map(|peer| (peer.sender.clone(), payload.clone())),
    );
}

pub(super) fn reject_pending_client_requests(
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

pub(super) fn reject_pending_requests_for_app(
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
