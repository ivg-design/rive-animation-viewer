use super::types::*;
use std::{
    fs::{self, File, OpenOptions},
    io::{Cursor, Write},
    path::{Path, PathBuf},
};

#[path = "spool/disk.rs"]
pub(crate) mod disk;
#[path = "spool/index.rs"]
mod index;
pub use index::{capture_sequence, record as record_index};

#[derive(Clone)]
pub struct Spool {
    pub dir: PathBuf,
    pub output: PathBuf,
    journal: PathBuf,
}
fn private_dir(path: &Path) -> Result<()> {
    #[allow(unused_mut)]
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(io)
}
fn registry() -> Result<PathBuf> {
    let root = std::env::temp_dir().join("rav-media-export-v1");
    if !root.exists() {
        match private_dir(&root) {
            Ok(()) => {}
            Err(e) if root.exists() => {
                let _ = e;
            }
            Err(e) => return Err(e),
        }
    }
    let meta = fs::symlink_metadata(&root).map_err(io)?;
    if !meta.is_dir() || meta.file_type().is_symlink() {
        return Err("Unsafe media spool registry".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if meta.permissions().mode() & 0o077 != 0 {
            return Err("Media spool registry must be private".into());
        }
    }
    Ok(root)
}
// Another reaper or the owning job may finish cleanup between filesystem calls.
fn allow_missing<T>(result: std::io::Result<T>) -> Result<Option<T>> {
    match result {
        Ok(value) => Ok(Some(value)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io(e)),
    }
}
pub fn reap_abandoned() -> Result<()> {
    for entry in fs::read_dir(registry()?).map_err(io)?.take(128) {
        let Some(entry) = allow_missing(entry)? else {
            continue;
        };
        let Some(meta) = allow_missing(fs::symlink_metadata(entry.path()))? else {
            continue;
        };
        if meta.len() > 16_384 || !meta.is_file() || meta.file_type().is_symlink() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        if uuid::Uuid::parse_str(&id).is_err() {
            continue;
        }
        let Ok(raw) = fs::read_to_string(entry.path()) else {
            continue;
        };
        let dir = if let Ok(marker) = serde_json::from_str::<serde_json::Value>(&raw) {
            if marker["retain_for_recovery"] == true {
                continue;
            }
            let owner = marker["pid"].as_u64().and_then(|n| u32::try_from(n).ok());
            // A live or unknown owner always wins, regardless of journal age.
            if owner.is_none_or(super::process::owner_alive) {
                continue;
            }
            let Some(path) = marker["path"].as_str() else {
                continue;
            };
            PathBuf::from(path)
        } else {
            // Legacy records have no reliable ownership; never reap them by age alone.
            continue;
        };
        if dir.is_absolute()
            && dir
                .file_name()
                .is_some_and(|s| s == format!(".rav-media-{id}").as_str())
        {
            if fs::symlink_metadata(&dir).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink()) {
                allow_missing(fs::remove_dir_all(&dir))?;
            }
            allow_missing(fs::remove_file(entry.path()))?;
        }
    }
    Ok(())
}
impl Spool {
    pub fn new(id: &str, path: &str, format: Format, overwrite: bool) -> Result<Self> {
        if path.len() > 4096 || path.contains('\0') {
            return Err("Invalid output path".into());
        }
        let requested = Path::new(path);
        if !requested.is_absolute() {
            return Err("Output path must be absolute".into());
        }
        let name = requested.file_name().ok_or("Output filename missing")?;
        if !requested.extension().is_some_and(|e| {
            e.eq_ignore_ascii_case(format.extension())
                || (format == Format::Apng && e.eq_ignore_ascii_case("png"))
                || (format == Format::Jpg && e.eq_ignore_ascii_case("jpeg"))
        }) {
            return Err(format!("Output extension must be .{}", format.extension()));
        }
        let parent = requested
            .parent()
            .ok_or("Output parent missing")?
            .canonicalize()
            .map_err(io)?;
        disk::ensure(&parent, 0)?;
        let output = parent.join(name);
        if let Ok(meta) = fs::symlink_metadata(&output) {
            if !overwrite || !meta.is_file() || meta.file_type().is_symlink() {
                return Err("Output exists, is a symlink, or is not a regular file".into());
            }
        }
        let dir = parent.join(format!(".rav-media-{id}"));
        let journal = registry()?.join(id);
        let mut marker = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&journal)
            .map_err(io)?;
        let record = serde_json::json!({"path":dir.to_str().ok_or("Output path is not UTF-8")?,"pid":std::process::id()});
        marker
            .write_all(record.to_string().as_bytes())
            .map_err(io)?;
        marker.sync_all().map_err(io)?;
        if let Err(e) = private_dir(&dir) {
            let _ = fs::remove_file(&journal);
            return Err(e);
        }
        Ok(Self {
            dir,
            output,
            journal,
        })
    }
    pub fn frame_path(&self, index: u32) -> PathBuf {
        self.dir.join(format!("master-{index:06}.png"))
    }
    pub fn retain_for_recovery(&self) -> Result<()> {
        let record = serde_json::json!({"path": self.dir, "pid": std::process::id(), "retain_for_recovery": true});
        fs::write(&self.journal, record.to_string()).map_err(io)
    }
    pub fn clean(&self) -> Result<()> {
        match fs::remove_dir_all(&self.dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(io(e)),
        }
        match fs::remove_file(&self.journal) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(io(e)),
        }
    }
    pub fn publish(&self, candidate: &Path, overwrite: bool) -> Result<u64> {
        let file = File::open(candidate).map_err(io)?;
        let size = file.metadata().map_err(io)?.len();
        if size == 0 {
            return Err("Invalid encoded output size".into());
        }
        disk::ensure_finalization(&self.dir, 0)?;
        file.sync_all().map_err(io)?;
        if overwrite {
            // rename atomically replaces the directory entry; never follows a destination symlink.
            fs::rename(candidate, &self.output).map_err(io)?;
        } else {
            // A pre-existence check + rename is NOT safe: link fails atomically if a racer won.
            fs::hard_link(candidate, &self.output)
                .map_err(|e| format!("Atomic no-clobber publish failed: {e}"))?;
        }
        #[cfg(unix)]
        {
            if let Some(parent) = self.output.parent() {
                // Publication has already committed; a directory fsync failure cannot undo it safely.
                let _ = File::open(parent).and_then(|f| f.sync_all());
            }
        }
        Ok(size)
    }
}
pub fn sanitize_png(bytes: &[u8], width: u32, height: u32) -> Result<Vec<u8>> {
    if bytes.len() as u64 > MAX_PNG || bytes.len() < 33 || bytes[..8] != *b"\x89PNG\r\n\x1a\n" {
        return Err("Invalid PNG signature/size".into());
    }
    // Parse chunk boundaries before allocating or decoding. Browser readback is 8-bit RGB/RGBA.
    let mut offset = 8usize;
    let mut ended = false;
    let mut sanitized = Vec::with_capacity(bytes.len());
    sanitized.extend_from_slice(&bytes[..8]);
    while offset + 12 <= bytes.len() {
        let size = u32::from_be_bytes(bytes[offset..offset + 4].try_into().map_err(io)?) as usize;
        let end = offset
            .checked_add(12)
            .and_then(|n| n.checked_add(size))
            .ok_or("PNG length overflow")?;
        if end > bytes.len() {
            return Err("Truncated PNG chunk".into());
        }
        let tag = &bytes[offset + 4..offset + 8];
        if !tag.iter().all(u8::is_ascii_alphabetic) || !tag[2].is_ascii_uppercase() {
            return Err("Invalid PNG chunk type".into());
        }
        let checksum = u32::from_be_bytes(bytes[end - 4..end].try_into().map_err(io)?);
        if crc32(&bytes[offset + 4..end - 4]) != checksum {
            return Err("PNG chunk CRC mismatch".into());
        }
        if matches!(tag, b"acTL" | b"fcTL" | b"fdAT") {
            return Err("Capture frames must not be animated PNGs".into());
        }
        let keep = matches!(
            tag,
            b"IHDR" | b"IDAT" | b"IEND" | b"PLTE" | b"tRNS" | b"sRGB" | b"gAMA" | b"cHRM"
        );
        if !keep && tag[0].is_ascii_uppercase() {
            return Err("Unsupported critical PNG chunk".into());
        }
        // eXIf/iCCP/text and other ancillary metadata are CRC-checked but NEVER interpreted.
        // Drop them before either png::Decoder or any external encoder sees the image.
        if keep {
            sanitized.extend_from_slice(&bytes[offset..end]);
        }
        if tag == b"IEND" {
            ended = size == 0 && end == bytes.len();
            break;
        }
        offset = end;
    }
    if !ended {
        return Err("PNG missing final IEND or contains trailing bytes".into());
    }
    let mut decoder = png::Decoder::new_with_limits(
        Cursor::new(&sanitized),
        png::Limits {
            bytes: 64 * 1024 * 1024,
        },
    );
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    let mut reader = decoder.read_info().map_err(io)?;
    let info = reader.info();
    if info.width != width
        || info.height != height
        || info.bit_depth != png::BitDepth::Eight
        || !matches!(info.color_type, png::ColorType::Rgb | png::ColorType::Rgba)
        || info.interlaced
    {
        return Err("PNG must match job dimensions: non-interlaced 8-bit RGB/RGBA".into());
    }
    let size = reader.output_buffer_size();
    if size as u64 > MAX_PIXELS * 4 {
        return Err("Decoded PNG exceeds memory limit".into());
    }
    reader.next_frame(&mut vec![0; size]).map_err(io)?;
    reader.finish().map_err(io)?; // Includes remaining checksums, not merely IHDR inspection.
    drop(reader);
    Ok(sanitized)
}
pub fn write_new(path: &Path, data: &[u8]) -> Result<()> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .and_then(|mut f| f.write_all(data))
        .map_err(io)
}
const fn crc_table() -> [u32; 256] {
    let mut table = [0; 256];
    let mut i = 0;
    while i < 256 {
        let mut value = i as u32;
        let mut bit = 0;
        while bit < 8 {
            value = if value & 1 != 0 {
                0xedb88320 ^ (value >> 1)
            } else {
                value >> 1
            };
            bit += 1;
        }
        table[i] = value;
        i += 1;
    }
    table
}
fn crc32(bytes: &[u8]) -> u32 {
    const TABLE: [u32; 256] = crc_table();
    let mut crc = u32::MAX;
    for byte in bytes {
        crc = TABLE[((crc ^ *byte as u32) & 255) as usize] ^ (crc >> 8);
    }
    !crc
}
