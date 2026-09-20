//! Machine-bound entitlement keys for unlisted capabilities.
//!
//! A key is an Ed25519-signed JSON payload issued outside the application by
//! the holder of the private key. It names a subject, a scope list, an optional
//! expiry and the binding id of exactly one machine/user pair. The application
//! embeds only the public key: keys cannot be forged from the binary, and a key
//! copied to another machine or user account fails the binding check.
//!
//! Token format: `RAVK1.<base64url(payload)>.<base64url(signature)>`.

mod binding;
pub mod store;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
pub use binding::machine_binding_id;
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const TOKEN_PREFIX: &str = "RAVK1";
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
    pub token: Option<String>,
    pub scope: Option<String>,
    pub persist: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EntitlementStatus {
    pub machine_id: String,
    pub unlocked: bool,
    pub subject: Option<String>,
    pub scope: Option<Vec<String>>,
    pub expires: Option<u64>,
    pub reason: Option<String>,
}

const NO_STORED_KEY: &str =
    "No entitlement key is stored on this machine; pass token once to unlock";

fn entitlement_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}

fn check_scope(entitlement: &Entitlement, scope: Option<&str>) -> Result<(), String> {
    if let Some(scope) = scope {
        if !entitlement.scope.iter().any(|entry| entry == scope) {
            return Err(format!("Entitlement key does not grant {scope}"));
        }
    }
    Ok(())
}

fn status_from(machine_id: String, entitlement: &Entitlement) -> EntitlementStatus {
    EntitlementStatus {
        machine_id,
        unlocked: true,
        subject: Some(entitlement.subject.clone()),
        scope: Some(entitlement.scope.clone()),
        expires: Some(entitlement.expires),
        reason: None,
    }
}

/// Verifies a token (or the stored one when absent), persisting a freshly
/// supplied and valid token unless the caller opts out. Takes the verifier as
/// a parameter so tests can exercise the store/persist logic without the
/// embedded issuer key.
fn verify_and_maybe_persist_with(
    dir: &Path,
    token: Option<&str>,
    scope: Option<&str>,
    persist: Option<bool>,
    verifier: impl Fn(&str) -> Result<Entitlement, String>,
) -> Result<Entitlement, String> {
    match token {
        Some(token) => {
            let entitlement = verifier(token)?;
            check_scope(&entitlement, scope)?;
            if persist != Some(false) {
                store::save(dir, token)?;
            }
            Ok(entitlement)
        }
        None => {
            let stored = store::load(dir).ok_or(NO_STORED_KEY)?;
            // A stored key that no longer verifies is discarded so the next
            // status call reports locked instead of failing the same way again.
            let entitlement = verifier(&stored).inspect_err(|_| store::clear(dir))?;
            check_scope(&entitlement, scope)?;
            Ok(entitlement)
        }
    }
}

pub fn verify_and_maybe_persist(
    dir: &Path,
    token: Option<&str>,
    scope: Option<&str>,
    persist: Option<bool>,
) -> Result<Entitlement, String> {
    verify_and_maybe_persist_with(dir, token, scope, persist, verify)
}

fn locked_status(machine_id: String, reason: Option<String>) -> EntitlementStatus {
    EntitlementStatus {
        machine_id,
        unlocked: false,
        subject: None,
        scope: None,
        expires: None,
        reason,
    }
}

/// Loads and verifies the stored key for `dir`, clearing it on failure.
/// Takes the verifier as a parameter for the same reason as
/// `verify_and_maybe_persist_with`.
fn status_with_verifier(
    dir: &Path,
    machine_id: String,
    verifier: impl FnOnce(&str) -> Result<Entitlement, String>,
) -> EntitlementStatus {
    let Some(stored) = store::load(dir) else {
        return locked_status(machine_id, None);
    };
    match verifier(&stored) {
        Ok(entitlement) => status_from(machine_id, &entitlement),
        Err(reason) => {
            store::clear(dir);
            locked_status(machine_id, Some(reason))
        }
    }
}

#[tauri::command]
pub fn entitlement_status(app: tauri::AppHandle) -> Result<EntitlementStatus, String> {
    let dir = entitlement_dir(&app)?;
    let machine_id = machine_binding_id()?;
    Ok(status_with_verifier(&dir, machine_id, verify))
}

#[tauri::command]
pub fn entitlement_verify(
    app: tauri::AppHandle,
    request: EntitlementVerifyRequest,
) -> Result<Entitlement, String> {
    let dir = entitlement_dir(&app)?;
    verify_and_maybe_persist(
        &dir,
        request.token.as_deref(),
        request.scope.as_deref(),
        request.persist,
    )
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

    fn temp_dir(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("rav-entitlement-{name}-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn verify_with_stored_token_persists_and_falls_back_to_the_store() {
        let dir = temp_dir("verify");
        let pair = key_pair();
        let public = pair.public_key().as_ref().to_vec();
        let token = issue(&pair, &payload("m", 0));
        let verifier = move |candidate: &str| verify_with_key(candidate, &public, "m", 1_000);

        // A supplied token is persisted by default.
        let entitlement =
            verify_and_maybe_persist_with(&dir, Some(&token), None, None, verifier.clone())
                .unwrap();
        assert_eq!(entitlement.subject, "tester");
        assert_eq!(store::load(&dir).as_deref(), Some(token.as_str()));

        // With no token supplied, the stored one is used instead.
        store::clear(&dir);
        store::save(&dir, &token).unwrap();
        let from_store =
            verify_and_maybe_persist_with(&dir, None, None, None, verifier.clone()).unwrap();
        assert_eq!(from_store.subject, "tester");

        // With neither a token nor a stored key, the caller gets the
        // dedicated "pass token once" message.
        store::clear(&dir);
        let error = verify_and_maybe_persist_with(&dir, None, None, None, verifier).unwrap_err();
        assert_eq!(error, NO_STORED_KEY);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn status_clears_an_expired_stored_key() {
        let dir = temp_dir("status");
        let pair = key_pair();
        let public = pair.public_key().as_ref().to_vec();
        let expired = issue(&pair, &payload("m", 500));
        store::save(&dir, &expired).unwrap();

        let status = status_with_verifier(&dir, "m".into(), |candidate| {
            verify_with_key(candidate, &public, "m", 1_000)
        });
        assert!(!status.unlocked);
        assert!(status.reason.unwrap().contains("expired"));
        assert_eq!(store::load(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
