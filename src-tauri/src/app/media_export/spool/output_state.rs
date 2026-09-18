//! Read-only destination preflight. Begin/publish remain the authority for races.
use super::super::types::{io, Format, Result};
use serde::{Deserialize, Serialize};
use std::{fs, io::ErrorKind, path::Path};

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutputStateRequest {
    pub output_path: String,
    pub format: Format,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct OutputState {
    pub exists: bool,
    pub empty: bool,
    pub is_dir: bool,
}

pub(crate) fn inspect(request: OutputStateRequest) -> Result<OutputState> {
    if !request.format.is_directory() {
        return Err("Output directory checks require an image-sequence format".into());
    }
    let raw = &request.output_path;
    if raw.is_empty() || raw.len() > 4096 || raw.contains('\0') {
        return Err("Invalid output path".into());
    }
    let path = Path::new(raw);
    if !path.is_absolute() {
        return Err("Output path must be absolute".into());
    }
    // Match begin's normalization, including paths with a trailing separator.
    // Canonicalize only the parent so the final component is never followed.
    let name = path.file_name().ok_or("Output filename missing")?;
    let parent = path
        .parent()
        .ok_or("Output parent missing")?
        .canonicalize()
        .map_err(io)?;
    let output = parent.join(name);
    // Do not follow a destination symlink: begin refuses it, even with overwrite.
    // In particular, a dangling link is an existing, non-directory destination.
    let metadata = match fs::symlink_metadata(&output) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(OutputState {
                exists: false,
                empty: true,
                is_dir: false,
            });
        }
        Err(error) => return Err(io(error)),
    };
    let is_dir = metadata.is_dir() && !metadata.file_type().is_symlink();
    let empty = if is_dir {
        // Propagate iteration errors as well as errors opening the directory.
        fs::read_dir(&output)
            .map_err(io)?
            .next()
            .transpose()
            .map_err(io)?
            .is_none()
    } else {
        false
    };
    Ok(OutputState {
        exists: true,
        empty,
        is_dir,
    })
}
