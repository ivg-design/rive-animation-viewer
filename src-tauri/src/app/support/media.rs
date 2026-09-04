//! Production uses only approved bundled encoders. Isolated DEV may discover
//! installed tools, but those paths are never accepted as redistribution input.
mod manifest;
mod validation;

#[cfg(test)]
mod tests;

use crate::app::media_export::{self, EncoderConfig, TrustedBinary};
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

const PRODUCTION_IDENTIFIER: &str = "app.rive.animation.viewer";
const DEV_IDENTIFIER: &str = "app.rive.animation.viewer.flicker-test";

fn local_binary(path: PathBuf) -> Result<TrustedBinary, String> {
    let path = path.canonicalize().map_err(|error| error.to_string())?;
    let (sha256, size_bytes) = validation::hash_file(&path, validation::RESOURCE_LIMIT)?;
    Ok(TrustedBinary {
        path,
        sha256,
        size_bytes,
    })
}

fn local_dev_config() -> Result<EncoderConfig, String> {
    for root in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        let root = Path::new(root);
        if root.join("ffmpeg").is_file() && root.join("ffprobe").is_file() {
            return Ok(EncoderConfig {
                ffmpeg: local_binary(root.join("ffmpeg"))?,
                ffprobe: local_binary(root.join("ffprobe"))?,
                gifski: root
                    .join("gifski")
                    .is_file()
                    .then(|| local_binary(root.join("gifski")))
                    .transpose()?,
                provenance: "Local DEV tools; never copied or approved for redistribution".into(),
                distribution: None,
            });
        }
    }
    Err("No local DEV FFmpeg/ffprobe installation found".into())
}

fn dev_config<F>(root: &Path, local: F) -> Result<EncoderConfig, String>
where
    F: FnOnce() -> Result<EncoderConfig, String>,
{
    match fs::symlink_metadata(root.join("manifest.json")) {
        Ok(_) => manifest::load(root),
        Err(error) if error.kind() == ErrorKind::NotFound => local(),
        Err(error) => Err(error.to_string()),
    }
}

fn selected_config<F>(identifier: &str, root: &Path, local: F) -> Result<EncoderConfig, String>
where
    F: FnOnce() -> Result<EncoderConfig, String>,
{
    match identifier {
        DEV_IDENTIFIER => dev_config(root, local),
        PRODUCTION_IDENTIFIER => manifest::load(root),
        identifier => Err(format!(
            "Media encoders are disabled for non-production build identity {identifier}"
        )),
    }
}

pub fn configure_encoders(app: &AppHandle) {
    if let Err(error) = configure(app) {
        eprintln!("[rav-media] {error}");
    }
}

fn configure(app: &AppHandle) -> Result<(), String> {
    let identifier = app.config().identifier.as_str();
    if !matches!(identifier, DEV_IDENTIFIER | PRODUCTION_IDENTIFIER) {
        return Err(format!(
            "Media encoders are disabled for non-production build identity {identifier}"
        ));
    }
    let root = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("encoders");
    media_export::configure(selected_config(identifier, &root, local_dev_config)?)
}
