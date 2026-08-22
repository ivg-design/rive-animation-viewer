use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use reqwest::Url;
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CounterPayload {
    pub(super) schema: u8,
    pub(super) event: &'static str,
    pub(super) token: String,
    pub(super) release: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) period: Option<String>,
}

pub(super) fn validate_endpoint(value: &str) -> Result<Url, String> {
    let endpoint =
        Url::parse(value).map_err(|error| format!("invalid counter endpoint: {error}"))?;
    if endpoint.scheme() != "https" {
        return Err("counter endpoint must use HTTPS".to_string());
    }
    if !endpoint.username().is_empty() || endpoint.password().is_some() {
        return Err("counter endpoint must not contain credentials".to_string());
    }
    if endpoint.query().is_some() || endpoint.fragment().is_some() {
        return Err("counter endpoint must not contain a query or fragment".to_string());
    }
    if endpoint.path() != "/v1/event" {
        return Err("counter endpoint must end at /v1/event".to_string());
    }
    Ok(endpoint)
}

pub(super) fn utc_epoch_seconds(now: SystemTime) -> u64 {
    now.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn civil_from_days(days_since_epoch: i64) -> (i64, u32, u32) {
    let shifted = days_since_epoch + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    if month <= 2 {
        year += 1;
    }
    (year, month as u32, day as u32)
}

pub(super) fn utc_month(now: SystemTime) -> String {
    let days = (utc_epoch_seconds(now) / 86_400) as i64;
    let (year, month, _) = civil_from_days(days);
    format!("{year:04}-{month:02}")
}

pub(super) fn monthly_token(secret: &str, period: &str) -> Result<String, String> {
    let secret = URL_SAFE_NO_PAD
        .decode(secret)
        .map_err(|_| "counter activity secret is invalid".to_string())?;
    let mut message = b"rav:monthly-active:v1:".to_vec();
    message.extend_from_slice(period.as_bytes());
    let digest = hmac_sha256(&secret, &message);
    Ok(URL_SAFE_NO_PAD.encode(&digest[..16]))
}

pub(super) fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK_SIZE: usize = 64;
    let mut block_key = [0_u8; BLOCK_SIZE];
    if key.len() > BLOCK_SIZE {
        block_key[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block_key[..key.len()].copy_from_slice(key);
    }

    let mut inner_pad = [0x36_u8; BLOCK_SIZE];
    let mut outer_pad = [0x5c_u8; BLOCK_SIZE];
    for index in 0..BLOCK_SIZE {
        inner_pad[index] ^= block_key[index];
        outer_pad[index] ^= block_key[index];
    }

    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner_digest = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);
    outer.finalize().into()
}
