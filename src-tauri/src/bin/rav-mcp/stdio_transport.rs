use anyhow::{anyhow, Context, Result};
use serde_json::Value;
use tokio::io::{self, AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, BufWriter};

use crate::bridge::Bridge;
use crate::rpc::handle_request;

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum StdioMessageFormat {
    ContentLength,
    JsonLine,
}

pub async fn read_message(
    reader: &mut BufReader<tokio::io::Stdin>,
) -> Result<Option<(Value, StdioMessageFormat)>> {
    let mut content_length = None;

    loop {
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line).await?;
        if bytes_read == 0 {
            return Ok(None);
        }

        if content_length.is_none() {
            let trimmed = line.trim();
            if !trimmed.is_empty() && trimmed.starts_with('{') {
                let message = serde_json::from_str::<Value>(trimmed)?;
                return Ok(Some((message, StdioMessageFormat::JsonLine)));
            }
        }

        if line == "\n" || line == "\r\n" {
            break;
        }

        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                let parsed = value
                    .trim()
                    .parse::<usize>()
                    .context("invalid Content-Length header")?;
                content_length = Some(parsed);
            }
        }
    }

    let length = content_length.ok_or_else(|| anyhow!("missing Content-Length header"))?;
    let mut payload = vec![0_u8; length];
    reader.read_exact(&mut payload).await?;
    let message = serde_json::from_slice::<Value>(&payload)?;
    Ok(Some((message, StdioMessageFormat::ContentLength)))
}

pub async fn write_message(
    writer: &mut BufWriter<tokio::io::Stdout>,
    value: &Value,
    format: StdioMessageFormat,
) -> Result<()> {
    let payload = serde_json::to_vec(value)?;
    match format {
        StdioMessageFormat::ContentLength => {
            let header = format!("Content-Length: {}\r\n\r\n", payload.len());
            writer.write_all(header.as_bytes()).await?;
            writer.write_all(&payload).await?;
        }
        StdioMessageFormat::JsonLine => {
            writer.write_all(&payload).await?;
            writer.write_all(b"\n").await?;
        }
    }
    writer.flush().await?;
    Ok(())
}

pub async fn run_stdio_server(bridge: Bridge) -> Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin);
    let mut writer = BufWriter::new(stdout);

    loop {
        let Some((message, incoming_format)) = read_message(&mut reader).await? else {
            break;
        };

        let is_notification = message.get("id").is_none();
        if is_notification {
            continue;
        }

        let response = handle_request(&bridge, message).await;
        write_message(&mut writer, &response, incoming_format).await?;
    }

    Ok(())
}
