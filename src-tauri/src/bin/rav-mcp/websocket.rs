use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::{accept_async, connect_async, tungstenite::Message};

use crate::bridge::Bridge;
use crate::support::constants::RECONNECT_DELAY_MS;

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum BridgePeerRole {
    App,
    Client,
}

fn parse_bridge_peer_role(message: &Value) -> Option<BridgePeerRole> {
    match message.get("bridgeHello").and_then(Value::as_str) {
        Some("rav-app") => Some(BridgePeerRole::App),
        Some("rav-mcp-client") => Some(BridgePeerRole::Client),
        _ => None,
    }
}

pub async fn run_websocket_bridge(bridge: Bridge, ws_port: u16) -> Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", ws_port))
        .await
        .with_context(|| format!("failed to bind WebSocket bridge on 127.0.0.1:{ws_port}"))?;

    eprintln!("[rav-mcp] WebSocket bridge listening on ws://127.0.0.1:{ws_port}");

    loop {
        let (stream, _) = listener.accept().await?;
        let bridge_clone = bridge.clone();

        tokio::spawn(async move {
            let websocket = match accept_async(stream).await {
                Ok(websocket) => websocket,
                Err(error) => {
                    eprintln!("[rav-mcp] WebSocket handshake failed: {error}");
                    return;
                }
            };

            let (mut sink, mut stream) = websocket.split();
            let (tx, mut rx) = mpsc::unbounded_channel::<String>();
            let Some(first_message) = stream.next().await else {
                return;
            };
            let first_value = match first_message {
                Ok(Message::Text(text)) => serde_json::from_str::<Value>(&text).ok(),
                Ok(Message::Binary(bytes)) => serde_json::from_slice::<Value>(&bytes).ok(),
                Ok(Message::Close(_)) => None,
                Ok(_) => None,
                Err(error) => {
                    eprintln!("[rav-mcp] WebSocket error before handshake: {error}");
                    None
                }
            };
            let Some(first_value) = first_value else {
                eprintln!("[rav-mcp] Bridge peer disconnected before handshake");
                return;
            };
            let Some(role) = parse_bridge_peer_role(&first_value) else {
                eprintln!("[rav-mcp] Bridge peer did not send a valid handshake");
                return;
            };
            let connection_id = bridge_clone.register_bridge_peer(role, tx.clone()).await;

            match role {
                BridgePeerRole::App => eprintln!("[rav-mcp] RAV connected"),
                BridgePeerRole::Client => eprintln!("[rav-mcp] MCP client connected"),
            }

            let write_task = tokio::spawn(async move {
                while let Some(payload) = rx.recv().await {
                    if sink.send(Message::Text(payload)).await.is_err() {
                        break;
                    }
                }
            });

            while let Some(message) = stream.next().await {
                match message {
                    Ok(Message::Text(text)) => match serde_json::from_str::<Value>(&text) {
                        Ok(value) => {
                            if parse_bridge_peer_role(&value).is_some() {
                                continue;
                            }
                            match role {
                                BridgePeerRole::App => bridge_clone.relay_app_response(value).await,
                                BridgePeerRole::Client => {
                                    let request_id = value.get("id").cloned().unwrap_or(Value::Null);
                                    if let Err(error) =
                                        bridge_clone.relay_client_request(connection_id, value).await
                                    {
                                        let _ = tx.send(
                                            json!({ "id": request_id, "error": error.to_string() })
                                                .to_string(),
                                        );
                                    }
                                }
                            }
                        }
                        Err(_) => eprintln!("[rav-mcp] Received invalid JSON from bridge peer"),
                    },
                    Ok(Message::Binary(bytes)) => match serde_json::from_slice::<Value>(&bytes) {
                        Ok(value) => {
                            if parse_bridge_peer_role(&value).is_some() {
                                continue;
                            }
                            match role {
                                BridgePeerRole::App => bridge_clone.relay_app_response(value).await,
                                BridgePeerRole::Client => {
                                    let request_id = value.get("id").cloned().unwrap_or(Value::Null);
                                    if let Err(error) =
                                        bridge_clone.relay_client_request(connection_id, value).await
                                    {
                                        let _ = tx.send(
                                            json!({ "id": request_id, "error": error.to_string() })
                                                .to_string(),
                                        );
                                    }
                                }
                            }
                        }
                        Err(_) => eprintln!("[rav-mcp] Received invalid JSON from bridge peer"),
                    },
                    Ok(Message::Close(_)) => break,
                    Ok(_) => {}
                    Err(error) => {
                        eprintln!("[rav-mcp] WebSocket error: {error}");
                        break;
                    }
                }
            }

            write_task.abort();
            bridge_clone
                .handle_bridge_disconnect(
                    connection_id,
                    role,
                    match role {
                        BridgePeerRole::App => "RAV disconnected".into(),
                        BridgePeerRole::Client => "MCP client disconnected".into(),
                    },
                )
                .await;
            match role {
                BridgePeerRole::App => eprintln!("[rav-mcp] RAV disconnected"),
                BridgePeerRole::Client => eprintln!("[rav-mcp] MCP client disconnected"),
            }
        });
    }
}

pub async fn run_websocket_client_bridge(bridge: Bridge, ws_port: u16) -> Result<()> {
    let url = format!("ws://127.0.0.1:{ws_port}");

    loop {
        let websocket = match connect_async(url.as_str()).await {
            Ok((websocket, _)) => websocket,
            Err(_error) => {
                tokio::time::sleep(std::time::Duration::from_millis(RECONNECT_DELAY_MS)).await;
                continue;
            }
        };

        let (mut sink, mut stream) = websocket.split();
        sink.send(Message::Text(
            json!({ "bridgeHello": "rav-mcp-client" }).to_string(),
        ))
        .await
        .context("failed to send MCP client handshake")?;
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let connection_id = bridge.register_connection(tx).await;

        let write_task = tokio::spawn(async move {
            while let Some(payload) = rx.recv().await {
                if sink.send(Message::Text(payload)).await.is_err() {
                    break;
                }
            }
        });

        while let Some(message) = stream.next().await {
            match message {
                Ok(Message::Text(text)) => match serde_json::from_str::<Value>(&text) {
                    Ok(value) => bridge.handle_incoming_message(value).await,
                    Err(_) => eprintln!("[rav-mcp] Received invalid JSON from bridge"),
                },
                Ok(Message::Binary(bytes)) => match serde_json::from_slice::<Value>(&bytes) {
                    Ok(value) => bridge.handle_incoming_message(value).await,
                    Err(_) => eprintln!("[rav-mcp] Received invalid JSON from bridge"),
                },
                Ok(Message::Close(_)) => break,
                Ok(_) => {}
                Err(error) => {
                    eprintln!("[rav-mcp] Bridge socket error: {error}");
                    break;
                }
            }
        }

        write_task.abort();
        bridge
            .handle_disconnect(connection_id, "RAV bridge disconnected".into())
            .await;
        tokio::time::sleep(std::time::Duration::from_millis(RECONNECT_DELAY_MS)).await;
    }
}
