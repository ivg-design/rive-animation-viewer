use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

pub(super) const MANIFEST_LIMIT: u64 = 256 * 1024;
pub(super) const RESOURCE_LIMIT: u64 = 512 * 1024 * 1024;

pub(super) fn runtime_target() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

pub(super) fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(super) fn is_meaningful(value: &str) -> bool {
    let value = value.trim();
    let lowered = value.to_ascii_lowercase();
    value.len() >= 3
        && !lowered.contains("replace")
        && !lowered.contains("example")
        && !lowered.contains("todo")
}

pub(super) fn is_https(value: &str) -> bool {
    value.starts_with("https://") && !value.contains(char::is_whitespace)
}

fn safe_relative(value: &str, plain_filename: bool) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if value.is_empty() || path.is_absolute() {
        return Err("Encoder manifest paths must be relative".into());
    }
    let components = path.components().collect::<Vec<_>>();
    if components.is_empty()
        || components
            .iter()
            .any(|part| !matches!(part, Component::Normal(_)))
        || (plain_filename && components.len() != 1)
    {
        return Err("Encoder manifest contains an unsafe resource path".into());
    }
    Ok(path.to_path_buf())
}

pub(super) fn hash_file(path: &Path, limit: u64) -> Result<(String, u64), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > limit {
        return Err("Encoder resource must be a bounded regular file, not a symlink".into());
    }
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hash = Sha256::new();
    let mut bytes = [0; 65_536];
    loop {
        let count = file.read(&mut bytes).map_err(|error| error.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&bytes[..count]);
    }
    Ok((format!("{:x}", hash.finalize()), metadata.len()))
}

pub(super) struct Integrity<'a> {
    pub file: &'a str,
    pub sha256: &'a str,
    pub size_bytes: u64,
}

pub(super) fn verified_resource(
    root: &Path,
    entry: Integrity<'_>,
    plain_filename: bool,
    limit: u64,
) -> Result<PathBuf, String> {
    if !is_sha256(entry.sha256) || entry.size_bytes == 0 || entry.size_bytes > limit {
        return Err("Encoder resource requires a valid size and SHA-256".into());
    }
    let relative = safe_relative(entry.file, plain_filename)?;
    let path = root.join(relative);
    let canonical_root = root.canonicalize().map_err(|error| error.to_string())?;
    let canonical_path = path.canonicalize().map_err(|error| error.to_string())?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Encoder resource escapes its signed resource directory".into());
    }
    let (actual_hash, actual_size) = hash_file(&path, limit)?;
    if actual_size != entry.size_bytes || actual_hash != entry.sha256.to_ascii_lowercase() {
        return Err(format!(
            "Encoder resource integrity mismatch: {}",
            entry.file
        ));
    }
    Ok(path)
}
