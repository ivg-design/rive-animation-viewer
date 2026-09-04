//! Preserve acknowledged source data on storage failure; never publish unverified media.
use super::*;
use std::io::{Seek, SeekFrom, Write};

impl Backend {
    // A renderer failure is not user cancellation. Serialize with append/finish so
    // the receipt and retained prefix describe exactly the native accepted data.
    pub fn abort(&self, request: AbortRequest) -> Result<Job> {
        let entry = self.get(&request.job_id)?;
        let mut inner = entry.inner.lock().map_err(io)?;
        if inner.job.state != "capturing" {
            return Ok(inner.job.clone());
        }
        let mut end = request.error.len().min(4096);
        while !request.error.is_char_boundary(end) {
            end -= 1;
        }
        let error = if end == 0 {
            "Capture aborted by renderer"
        } else {
            &request.error[..end]
        };
        if inner.job.received_frames == 0 {
            fail(&entry, &mut inner, error.into()); // No acknowledged prefix exists.
        } else {
            inner.job.state = "failed".into();
            inner.job.stage = "failed".into();
            inner.job.error = Some(error.into());
            retain(&entry, &mut inner, true);
        }
        Ok(inner.job.clone())
    }
}

pub(super) fn storage_error(error: &str) -> bool {
    [
        "Capture storage I/O failed:",
        "Output publication failed:",
        "Destination disk is low on space",
        "Cannot query destination disk",
        "No space left on device",
        "Input/output error",
        "Permission denied",
        "Read-only file system",
        "There is not enough space on the disk",
    ]
    .iter()
    .any(|text| error.contains(text))
}
pub(super) fn retain(entry: &Entry, inner: &mut Inner, capture: bool) {
    if let Some(stream) = inner.stream.take() {
        stream.discard();
    }
    inner.job.resolved_settings["recovery_spool"] = json!(entry.spool.dir);
    let count = accepted_count(entry, inner);
    inner.job.resolved_settings["accepted_frame_count"] = json!(count);
    if let Err(e) = entry.spool.retain_for_recovery() {
        inner
            .job
            .warnings
            .push(format!("Recovery journal could not be marked: {e}"));
    }
    let repair = if capture {
        truncate_accepted(entry, inner)
    } else {
        Ok(())
    };
    let repaired = repair.is_ok();
    if let Err(e) = repair {
        inner.job.warnings.push(format!(
            "Unacknowledged tail could not be removed; recovery requires repair: {e}"
        ));
    }
    let descriptor = json!({"request": entry.request,
        "frame_count": inner.job.frame_count.unwrap_or(count), "accepted_frame_count": count,
        "received_frames": inner.job.received_frames, "bytes_spooled": inner.job.bytes_spooled,
        "accepted_prefix_repaired": repaired, "error": inner.job.error});
    if let Err(e) = fs::write(
        entry.spool.dir.join("recovery.json"),
        descriptor.to_string(),
    ) {
        inner
            .job
            .warnings
            .push(format!("Recovery descriptor could not be written: {e}"));
    }
    inner.job.warnings.push("Capture stopped after an error; accepted capture retained for manual recovery, not published.".into());
}
fn truncate_accepted(entry: &Entry, inner: &Inner) -> Result<()> {
    if let Some(codec) = entry.request.capture_codec.as_deref() {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .open(stream::path(&entry.spool, codec))
            .map_err(io)?;
        require_prefix(&file, inner.job.bytes_spooled)?;
        file.set_len(inner.job.bytes_spooled).map_err(io)?;
        if codec == "vp9" {
            file.seek(SeekFrom::Start(24)).map_err(io)?;
            file.write_all(&inner.job.received_frames.to_le_bytes())
                .map_err(io)?;
        }
        file.sync_all().map_err(io)?;
    } else {
        let file = fs::OpenOptions::new()
            .write(true)
            .open(entry.spool.dir.join("frames.idx"))
            .map_err(io)?;
        let expected = inner.job.received_frames as u64 * 4;
        require_prefix(&file, expected)?;
        file.set_len(expected).map_err(io)?;
        file.sync_all().map_err(io)?;
    }
    Ok(())
}

fn require_prefix(file: &fs::File, expected: u64) -> Result<()> {
    let actual = file.metadata().map_err(io)?.len();
    if actual < expected {
        return Err(format!("Capture file is shorter than acknowledged prefix ({actual} < {expected}); cannot restore missing bytes"));
    }
    Ok(())
}

#[cfg(test)]
#[path = "recovery_finish_tests.rs"]
mod finish_tests;
#[cfg(test)]
#[path = "recovery_tests.rs"]
mod tests;
