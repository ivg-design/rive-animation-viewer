//! Machine + account identity used to bind an entitlement key to one device.

use sha2::{Digest, Sha256};
use std::process::Command;

const BINDING_SALT: &str = "rav-entitlement-v1";

fn platform_uuid() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout);
        let line = text.lines().find(|line| line.contains("IOPlatformUUID"))?;
        let value = line.split('=').nth(1)?.trim().trim_matches('"');
        (!value.is_empty()).then(|| value.to_owned())
    }
    #[cfg(target_os = "windows")]
    {
        // The per-installation GUID Windows writes at setup. Read through
        // `reg query` so no registry crate is needed; the console window the
        // child would otherwise flash is suppressed.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let output = Command::new("reg")
            .args([
                "query",
                r"HKLM\SOFTWARE\Microsoft\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .ok()?;
        parse_reg_query_value(&String::from_utf8_lossy(&output.stdout), "MachineGuid")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::fs::read_to_string("/etc/machine-id")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    }
}

/// Extracts a value from `reg query` output, whose data line has the shape
/// `    <name>    REG_SZ    <value>`.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn parse_reg_query_value(output: &str, name: &str) -> Option<String> {
    output
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with(name))
        .and_then(|line| line.split_whitespace().nth(2))
        .map(str::to_owned)
        .filter(|value| !value.is_empty())
}

fn account_name() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "unknown".into())
}

fn encode_binding(uuid: &str, user: &str) -> String {
    let digest = Sha256::digest(format!("{BINDING_SALT}|{uuid}|{user}").as_bytes());
    let encoded = base32_lower(&digest);
    encoded[..26].to_owned()
}

fn base32_lower(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";
    let mut output = String::new();
    let mut buffer: u32 = 0;
    let mut bits = 0u32;
    for &byte in bytes {
        buffer = (buffer << 8) | u32::from(byte);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            output.push(ALPHABET[((buffer >> bits) & 31) as usize] as char);
        }
    }
    if bits > 0 {
        output.push(ALPHABET[((buffer << (5 - bits)) & 31) as usize] as char);
    }
    output
}

/// Stable id for this machine + account. Hardware UUID and the account name
/// are hashed together, so neither a copied key nor a shared machine with a
/// different login satisfies the binding.
pub fn machine_binding_id() -> Result<String, String> {
    let uuid = platform_uuid().ok_or("Machine identity is unavailable on this platform")?;
    Ok(encode_binding(&uuid, &account_name()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_machine_guid_from_reg_query_output() {
        let output = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    3f2c9e5a-1b7d-4c1e-9a0b-8d6f2e4c1a55\r\n\r\n";
        assert_eq!(
            parse_reg_query_value(output, "MachineGuid").as_deref(),
            Some("3f2c9e5a-1b7d-4c1e-9a0b-8d6f2e4c1a55")
        );
        assert_eq!(
            parse_reg_query_value(
                "ERROR: The system was unable to find the specified registry key or value.",
                "MachineGuid"
            ),
            None
        );
        assert_eq!(
            parse_reg_query_value("    MachineGuid    REG_SZ    ", "MachineGuid"),
            None
        );
    }

    #[test]
    fn binding_is_stable_and_distinguishes_user_and_machine() {
        let a = encode_binding("UUID-A", "ivg");
        assert_eq!(a, encode_binding("UUID-A", "ivg"));
        assert_eq!(a.len(), 26);
        assert_ne!(a, encode_binding("UUID-B", "ivg"));
        assert_ne!(a, encode_binding("UUID-A", "other"));
        assert!(a
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()));
    }
}
