//! Machine-bound entitlement keys for unlisted capabilities.
//!
//! A key is an Ed25519-signed JSON payload issued outside the application by
//! the holder of the private key. It names a subject, a scope list, an optional
//! expiry and the binding id of exactly one machine/user pair. The application
//! embeds only the public key: keys cannot be forged from the binary, and a key
//! copied to another machine or user account fails the binding check.
//!
//! Token format: `RAVK1.<base64url(payload)>.<base64url(signature)>`.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

const TOKEN_PREFIX: &str = "RAVK1";
const BINDING_SALT: &str = "rav-entitlement-v1";
/// Raw 32-byte Ed25519 public key of the issuer. The private half never ships.
const ISSUER_PUBLIC_KEY: [u8; 32] = [
    0x85, 0x0b, 0x0f, 0xc5, 0x7c, 0x28, 0x6a, 0xe7, 0x6d, 0xff, 0x41, 0x8b, 0x77, 0x21, 0x70, 0x24,
    0x4f, 0x6c, 0x94, 0xad, 0x35, 0x1c, 0x99, 0x0b, 0x87, 0xd5, 0xce, 0x11, 0xe4, 0x48, 0x41, 0xc3,
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EntitlementPayload {
    pub v: u8,
    pub sub: String,
    pub mid: String,
    pub scope: Vec<String>,
    #[serde(default)]
    pub exp: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Entitlement {
    pub subject: String,
    pub scope: Vec<String>,
    pub expires: u64,
    pub machine_id: String,
}

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

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

pub fn verify_with_key(
    token: &str,
    public_key: &[u8],
    machine_id: &str,
    now: u64,
) -> Result<Entitlement, String> {
    let token = token.trim();
    let mut parts = token.split('.');
    let (Some(prefix), Some(payload), Some(signature), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err("Malformed entitlement key".into());
    };
    if prefix != TOKEN_PREFIX {
        return Err("Unsupported entitlement key version".into());
    }
    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| "Malformed entitlement payload")?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(signature)
        .map_err(|_| "Malformed entitlement signature")?;
    UnparsedPublicKey::new(&ED25519, public_key)
        .verify(&payload_bytes, &signature_bytes)
        .map_err(|_| "Entitlement signature is invalid")?;
    let parsed: EntitlementPayload =
        serde_json::from_slice(&payload_bytes).map_err(|_| "Entitlement payload is invalid")?;
    if parsed.v != 1 {
        return Err("Unsupported entitlement payload version".into());
    }
    if parsed.mid != machine_id {
        return Err("Entitlement key is bound to a different machine or account".into());
    }
    if parsed.exp != 0 && parsed.exp < now {
        return Err("Entitlement key has expired".into());
    }
    Ok(Entitlement {
        subject: parsed.sub,
        scope: parsed.scope,
        expires: parsed.exp,
        machine_id: parsed.mid,
    })
}

pub fn verify(token: &str) -> Result<Entitlement, String> {
    verify_with_key(
        token,
        &ISSUER_PUBLIC_KEY,
        &machine_binding_id()?,
        now_seconds(),
    )
}

#[derive(Deserialize)]
pub struct EntitlementVerifyRequest {
    pub token: String,
    pub scope: Option<String>,
}

#[tauri::command]
pub fn entitlement_machine_id() -> Result<String, String> {
    machine_binding_id()
}

#[tauri::command]
pub fn entitlement_verify(request: EntitlementVerifyRequest) -> Result<Entitlement, String> {
    let entitlement = verify(&request.token)?;
    if let Some(scope) = request.scope.as_deref() {
        if !entitlement.scope.iter().any(|entry| entry == scope) {
            return Err(format!("Entitlement key does not grant {scope}"));
        }
    }
    Ok(entitlement)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ring::rand::SystemRandom;
    use ring::signature::{Ed25519KeyPair, KeyPair};

    fn issue(pair: &Ed25519KeyPair, payload: &EntitlementPayload) -> String {
        let bytes = serde_json::to_vec(payload).unwrap();
        let signature = pair.sign(&bytes);
        format!(
            "{TOKEN_PREFIX}.{}.{}",
            URL_SAFE_NO_PAD.encode(&bytes),
            URL_SAFE_NO_PAD.encode(signature.as_ref())
        )
    }

    fn key_pair() -> Ed25519KeyPair {
        let document = Ed25519KeyPair::generate_pkcs8(&SystemRandom::new()).unwrap();
        Ed25519KeyPair::from_pkcs8(document.as_ref()).unwrap()
    }

    fn payload(mid: &str, exp: u64) -> EntitlementPayload {
        EntitlementPayload {
            v: 1,
            sub: "tester".into(),
            mid: mid.into(),
            scope: vec!["inspection.full".into()],
            exp,
        }
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

    #[test]
    fn valid_key_unlocks_only_its_own_binding() {
        let pair = key_pair();
        let public = pair.public_key().as_ref().to_vec();
        let token = issue(&pair, &payload("machine-one", 0));
        let ok = verify_with_key(&token, &public, "machine-one", 1_000).unwrap();
        assert_eq!(ok.subject, "tester");
        assert_eq!(ok.scope, vec!["inspection.full".to_string()]);
        assert!(verify_with_key(&token, &public, "machine-two", 1_000)
            .unwrap_err()
            .contains("different machine"));
    }

    #[test]
    fn expiry_tampering_and_foreign_issuers_are_rejected() {
        let pair = key_pair();
        let public = pair.public_key().as_ref().to_vec();
        let expiring = issue(&pair, &payload("m", 500));
        assert!(verify_with_key(&expiring, &public, "m", 400).is_ok());
        assert!(verify_with_key(&expiring, &public, "m", 600)
            .unwrap_err()
            .contains("expired"));
        let token = issue(&pair, &payload("m", 0));
        let mut parts: Vec<&str> = token.split('.').collect();
        let forged = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload("other", 0)).unwrap());
        parts[1] = &forged;
        assert!(verify_with_key(&parts.join("."), &public, "other", 1)
            .unwrap_err()
            .contains("signature"));
        let other = key_pair();
        assert!(verify_with_key(&token, other.public_key().as_ref(), "m", 1).is_err());
        assert!(verify_with_key("nonsense", &public, "m", 1).is_err());
        assert!(verify_with_key("RAVK9.a.b", &public, "m", 1).is_err());
    }
}
