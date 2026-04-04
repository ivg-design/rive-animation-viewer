use anyhow::Result;
use std::time::Duration;

mod bridge;
mod cli;
mod constants;
mod instructions;
mod rpc;
mod stdio_transport;
mod tool_registry;
mod websocket;

use bridge::Bridge;
use cli::{parse_cli_options, RunMode};
use stdio_transport::run_stdio_server;
use websocket::{run_websocket_bridge, run_websocket_client_bridge};

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let options = parse_cli_options()?;

    let bridge = Bridge::new(Duration::from_millis(options.command_timeout_ms));
    match options.mode {
        RunMode::BridgeOnly => run_websocket_bridge(bridge, options.ws_port).await,
        RunMode::StdioOnly => {
            let websocket_client = run_websocket_client_bridge(bridge.clone(), options.ws_port);
            let stdio_server = run_stdio_server(bridge);
            tokio::select! {
                result = websocket_client => result,
                result = stdio_server => result,
            }
        }
        RunMode::Combined => {
            let websocket_bridge = run_websocket_bridge(bridge.clone(), options.ws_port);
            let stdio_server = run_stdio_server(bridge);

            tokio::select! {
                result = websocket_bridge => result,
                result = stdio_server => result,
            }
        }
    }
}
