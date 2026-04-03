use anyhow::{anyhow, Context, Result};
use std::env;

use crate::constants::{DEFAULT_COMMAND_TIMEOUT_MS, DEFAULT_WS_PORT};

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum RunMode {
    Combined,
    BridgeOnly,
    StdioOnly,
}

pub struct CliOptions {
    pub mode: RunMode,
    pub ws_port: u16,
    pub command_timeout_ms: u64,
}

pub fn parse_cli_options() -> Result<CliOptions> {
    let mut mode = RunMode::Combined;
    let mut ws_port = env::var("RAV_MCP_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_WS_PORT);
    let mut command_timeout_ms = env::var("RAV_MCP_TIMEOUT")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_COMMAND_TIMEOUT_MS);

    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--bridge-only" => mode = RunMode::BridgeOnly,
            "--stdio-only" => mode = RunMode::StdioOnly,
            "--port" => {
                let Some(value) = args.next() else {
                    return Err(anyhow!("--port requires a value"));
                };
                ws_port = value
                    .parse::<u16>()
                    .with_context(|| format!("invalid port value: {value}"))?;
            }
            "--timeout" => {
                let Some(value) = args.next() else {
                    return Err(anyhow!("--timeout requires a value"));
                };
                command_timeout_ms = value
                    .parse::<u64>()
                    .with_context(|| format!("invalid timeout value: {value}"))?;
            }
            _ => {}
        }
    }

    Ok(CliOptions {
        mode,
        ws_port,
        command_timeout_ms,
    })
}
