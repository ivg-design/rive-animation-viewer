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
    #[cfg(not(target_os = "macos"))]
    {
        std::fs::read_to_string("/etc/machine-id")
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
    }
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
