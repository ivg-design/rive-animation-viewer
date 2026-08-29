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
