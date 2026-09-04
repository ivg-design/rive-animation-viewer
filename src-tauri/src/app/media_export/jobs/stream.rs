//! CFR encoded capture: one record per access unit, in presentation order, no B frames.
use super::*;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::PathBuf;

pub(super) struct Stream {
    writer: BufWriter<fs::File>,
    codec: String,
    frames: u32,
    next_packet: u64,
}
fn u32_at(bytes: &[u8], offset: usize) -> Result<u32> {
    Ok(u32::from_le_bytes(
        bytes
            .get(offset..offset + 4)
            .ok_or("Truncated capture packet")?
            .try_into()
            .map_err(io)?,
    ))
}
fn records(bytes: &[u8], mut visit: impl FnMut(&[u8]) -> Result<()>) -> Result<u32> {
    if bytes.len() as u64 > MAX_PNG {
        return Err("Capture chunk exceeds 20 MiB".into());
    }
    let count = u32_at(bytes, 0)?;
    if count == 0 || count as usize > bytes.len().saturating_sub(4) / 5 {
        return Err("Invalid capture packet record count".into());
    }
    let mut offset = 4usize;
    for _ in 0..count {
        let length = u32_at(bytes, offset)? as usize;
        offset += 4;
        if length == 0 {
            return Err("Empty encoded access unit".into());
        }
        let end = offset
            .checked_add(length)
            .ok_or("Capture packet overflow")?;
        visit(
            bytes
                .get(offset..end)
                .ok_or("Truncated encoded access unit")?,
        )?;
        offset = end;
    }
    if offset != bytes.len() {
        return Err("Trailing capture packet data".into());
    }
    Ok(count)
}
pub(super) fn path(spool: &Spool, codec: &str) -> PathBuf {
    spool.dir.join(if codec == "vp9" {
        "capture.ivf"
    } else {
        "capture.annexb"
    })
}
// Make browser access-unit boundaries explicit even for identical consecutive IDRs.
fn delimiter(codec: &str, record: &[u8]) -> &'static [u8] {
    if codec == "vp9" {
        return &[];
    }
    let offset = if record.starts_with(&[0, 0, 0, 1]) {
        4
    } else {
        3
    };
    let nal = record.get(offset).copied().unwrap_or(0);
    if codec == "h264" {
        if nal & 31 == 9 {
            &[]
        } else {
            &[0, 0, 0, 1, 9, 0xf0]
        }
    } else if (nal >> 1) & 63 == 35 {
        &[]
    } else {
        &[0, 0, 0, 1, 0x46, 1, 0x50]
    }
}
impl Stream {
    pub(super) fn new(spool: &Spool, request: &BeginRequest) -> Result<Self> {
        let codec = request
            .capture_codec
            .as_ref()
            .ok_or("Missing capture codec")?
            .clone();
        spool::disk::ensure(&spool.dir, 32)?;
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path(spool, &codec))
            .map_err(io)?;
        let mut writer = BufWriter::with_capacity(64 * 1024, file);
        if codec == "vp9" {
            let mut header = [0u8; 32];
            header[..4].copy_from_slice(b"DKIF");
            header[6..8].copy_from_slice(&32u16.to_le_bytes());
            header[8..12].copy_from_slice(b"VP90");
            header[12..14].copy_from_slice(&(request.width as u16).to_le_bytes());
            header[14..16].copy_from_slice(&(request.height as u16).to_le_bytes());
            header[16..20].copy_from_slice(&request.fps.numerator.to_le_bytes());
            header[20..24].copy_from_slice(&request.fps.denominator.to_le_bytes());
            writer.write_all(&header).map_err(io)?;
        }
        Ok(Self {
            writer,
            codec,
            frames: 0,
            next_packet: 0,
        })
    }
    // Validate the complete envelope before any write; no packet-sized second buffer.
    pub(super) fn validate(&self, index: u32, bytes: &[u8]) -> Result<(u32, u64)> {
        if index as u64 != self.next_packet {
            return Err("Capture packet index must be contiguous from zero".into());
        }
        let mut delimiters = 0u64;
        let count = records(bytes, |record| {
            if self.codec != "vp9"
                && !record.starts_with(&[0, 0, 1])
                && !record.starts_with(&[0, 0, 0, 1])
            {
                return Err("H264/HEVC capture requires Annex B access units".into());
            }
            delimiters += delimiter(&self.codec, record).len() as u64;
            Ok(())
        })?;
        self.frames
            .checked_add(count)
            .ok_or("Capture exceeds u32 frame-count storage")?;
        let stored = bytes.len() as u64 - 4 - 4 * count as u64
            + if self.codec == "vp9" {
                12 * count as u64
            } else {
                delimiters
            };
        Ok((count, stored))
    }
    pub(super) fn write(&mut self, bytes: &[u8]) -> Result<()> {
        records(bytes, |record| {
            if self.codec == "vp9" {
                self.writer
                    .write_all(&(record.len() as u32).to_le_bytes())
                    .map_err(io)?;
                self.writer
                    .write_all(&(self.frames as u64).to_le_bytes())
                    .map_err(io)?;
            }
            self.writer
                .write_all(delimiter(&self.codec, record))
                .map_err(io)?;
            self.writer.write_all(record).map_err(io)?;
            self.frames = self
                .frames
                .checked_add(1)
                .ok_or("Capture frame-count overflow")?;
            Ok(())
        })?;
        // ACK means the bounded buffer has been written, not merely enqueued in userspace.
        self.writer.flush().map_err(io)?;
        self.next_packet += 1;
        Ok(())
    }
    // Never let BufWriter::drop flush an unacknowledged tail during recovery.
    pub(super) fn discard(self) {
        let _ = self.writer.into_parts();
    }
    pub(super) fn finish(mut self) -> Result<()> {
        self.writer.flush().map_err(io)?;
        if self.codec == "vp9" {
            let file = self.writer.get_mut();
            file.seek(SeekFrom::Start(24)).map_err(io)?;
            file.write_all(&self.frames.to_le_bytes()).map_err(io)?;
        }
        Ok(()) // Drop the handle before remux/publication/cancellation cleanup on Windows.
    }
}
pub(super) fn remux(
    binaries: &Binaries,
    request: &BeginRequest,
    spool: &Spool,
    count: u32,
    control: &Control,
) -> Result<(PathBuf, Value)> {
    let codec = request
        .capture_codec
        .as_deref()
        .ok_or("Missing capture codec")?;
    let input = path(spool, codec);
    let output = spool
        .dir
        .join(format!("candidate.{}", request.format.extension()));
    let mut args = encode::base();
    args.extend(["-xerror".into(), "-fflags".into(), "+genpts".into()]);
    if codec != "vp9" {
        args.extend(["-r".into(), request.fps.text()]);
    }
    args.extend([
        "-f".into(),
        if codec == "vp9" { "ivf" } else { codec }.into(),
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-map".into(),
        "0:v:0".into(),
        "-an".into(),
        "-c:v".into(),
        "copy".into(),
        "-fps_mode".into(),
        "passthrough".into(),
    ]);
    if codec != "vp9" {
        // Raw Annex B has no reliable presentation timestamps. Set packet clock explicitly;
        // input -r alone does not establish a monotonic CFR clock during stream copy.
        args.extend([
            "-bsf:v".into(),
            format!(
                "setts=pts=N:dts=N:duration=1:time_base={}/{}",
                request.fps.denominator, request.fps.numerator
            ),
        ]);
        args.extend(["-movflags".into(), "+faststart".into()]);
        if codec == "hevc" {
            args.extend(["-tag:v".into(), "hvc1".into()]);
        }
    }
    args.extend([
        "-progress".into(),
        "pipe:1".into(),
        output.to_string_lossy().into_owned(),
    ]);
    super::super::process::run(
        &binaries.ffmpeg,
        &args,
        None,
        control,
        600,
        &[output.clone(), spool.dir.clone()],
    )?;
    Ok((
        output,
        json!({ "encoder": "ffmpeg", "capture_codec": codec, "stream_copy": true,
        "codec": codec, "width": request.width, "height": request.height, "fps": request.fps,
        "frame_count": count, "duration_seconds": count as f64 / request.fps.value() }),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_stream_write_retains_only_acknowledged_bytes_and_ivf_count() {
        let dir = std::env::temp_dir().join(format!("rav-recovery-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let backend = Backend::new(super::super::super::discovery::Discovery {
            binaries: None,
            capabilities: json!({"formats":[{"id":"webm","available":true}]}),
        })
        .unwrap();
        let request: BeginRequest = serde_json::from_value(json!({
            "format":"webm", "capture_codec":"vp9", "width":64, "height":64,
            "fps":{"numerator":20,"denominator":1}, "output_path":dir.join("recovery.webm"),
            "source_session":"fixture" }))
        .unwrap();
        let job = backend.begin(request).unwrap();
        let body = [1, 0, 0, 0, 1, 0, 0, 0, 0x82];
        let accepted = backend.append("fixture", &job.job_id, 0, &body).unwrap();
        let entry = backend.get(&job.job_id).unwrap();
        let source = path(&entry.spool, "vp9");
        // Model a partial unacknowledged write already reaching the file as well.
        fs::OpenOptions::new()
            .append(true)
            .open(&source)
            .unwrap()
            .write_all(b"partial tail")
            .unwrap();
        {
            let mut inner = entry.inner.lock().unwrap();
            let stream = inner.stream.as_mut().unwrap();
            // Force a real EBADF on flush after writing a new record into BufWriter.
            stream.writer = BufWriter::new(fs::File::open(&source).unwrap());
        }
        assert!(backend
            .append("fixture", &job.job_id, 1, &body)
            .unwrap_err()
            .contains("storage I/O"));
        let failed = backend.status(&job.job_id).unwrap();
        assert_eq!(failed.stage, "failed");
        assert_eq!(failed.received_frames, 1);
        let bytes = fs::read(&source).unwrap();
        assert_eq!(bytes.len() as u64, accepted.bytes_spooled);
        assert_eq!(u32::from_le_bytes(bytes[24..28].try_into().unwrap()), 1);
        assert_eq!(bytes.last(), Some(&0x82));
        assert!(entry.spool.dir.join("recovery.json").exists());
        assert!(!dir.join("recovery.webm").exists());
        entry.spool.clean().unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
}
