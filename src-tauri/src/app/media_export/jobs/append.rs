use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};

impl Backend {
    pub fn append(
        &self,
        session_id: &str,
        job_id: &str,
        index: u32,
        bytes: &[u8],
    ) -> Result<CaptureReceipt> {
        if bytes.len() as u64 > MAX_PNG {
            return Err("Capture chunk exceeds 20 MiB".into());
        }
        let entry = self.get(job_id)?;
        if session_id.is_empty()
            || entry
                .request
                .source_session
                .as_ref()
                .and_then(Value::as_str)
                != Some(session_id)
        {
            return Err("Capture source session mismatch".into());
        }
        // Global transport admission bounds uploads; status contention must only wait.
        let mut inner = entry.inner.lock().map_err(io)?;
        if inner.job.state != "capturing" {
            return Err("Job is not capturing".into());
        }
        entry.control.check()?;
        if inner.disk_stopped {
            return Ok(receipt(&entry, &inner, index));
        }
        if let Some(stream) = inner.stream.as_ref() {
            let (frames, written) = stream.validate(index, bytes)?;
            let total = inner
                .job
                .bytes_spooled
                .checked_add(written)
                .ok_or("Capture byte count overflow")?;
            if !admit_disk(&entry, &mut inner, written)? {
                return Ok(receipt(&entry, &inner, index));
            }
            let result = inner
                .stream
                .as_mut()
                .ok_or("Capture stream missing")?
                .write(bytes);
            if let Err(error) = result {
                let error = format!("Capture storage I/O failed: {error}");
                fail(&entry, &mut inner, error.clone());
                return Err(error);
            }
            inner.job.received_frames += frames; // Stream validation checked u32 capacity first.
            inner.job.bytes_spooled = total;
            inner.touched = Instant::now();
        } else {
            if entry.request.capture_codec.is_some() {
                return Err("Capture stream is closed".into());
            }
            self.png(&entry, &mut inner, index, bytes)?;
        }
        Ok(receipt(&entry, &inner, index))
    }
    pub fn frame(&self, request: FrameRequest) -> Result<Job> {
        if request.png_base64.len() as u64 > MAX_PNG.div_ceil(3) * 4 {
            return Err("PNG transport limit".into());
        }
        let entry = self.get(&request.job_id)?;
        if entry.request.capture_codec.is_some() {
            return Err("Encoded capture requires binary append".into());
        }
        let mut inner = entry.inner.lock().map_err(io)?;
        if inner.job.state != "capturing" {
            return Err("Job is not capturing".into());
        }
        entry.control.check()?;
        if inner.disk_stopped {
            return Ok(inner.job.clone());
        }
        let bytes = STANDARD
            .decode(&request.png_base64)
            .map_err(|_| "Frame must be plain base64 PNG")?;
        self.png(&entry, &mut inner, request.frame_index, &bytes)?;
        Ok(inner.job.clone())
    }
    fn png(&self, entry: &Entry, inner: &mut Inner, index: u32, bytes: &[u8]) -> Result<()> {
        if !entry.request.format.animated() && index != 0 {
            return Err("Still formats accept only frame zero".into());
        }
        if index == u32::MAX {
            return Err("Frame index exceeds u32 frame-count storage".into());
        }
        if inner
            .last_index
            .map_or(index != 0, |previous| index <= previous)
        {
            return Err("Frame indices must start at zero and increase strictly".into());
        }
        let bytes = spool::sanitize_png(bytes, entry.request.width, entry.request.height)?;
        let incoming = bytes.len() as u64 + 4;
        let total = inner
            .job
            .bytes_spooled
            .checked_add(incoming)
            .ok_or("Capture byte count overflow")?;
        if !admit_disk(entry, inner, incoming)? {
            return Ok(());
        }
        let result = (|| {
            spool::write_new(&entry.spool.frame_path(index), &bytes)?;
            spool::record_index(&entry.spool, index)
        })();
        if let Err(error) = result {
            let error = format!("Capture storage I/O failed: {error}");
            fail(entry, inner, error.clone());
            return Err(error);
        }
        inner.last_index = Some(index);
        inner.job.received_frames += 1;
        inner.job.bytes_spooled = total;
        inner.touched = Instant::now();
        Ok(())
    }
}

fn receipt(entry: &Entry, inner: &Inner, index: u32) -> CaptureReceipt {
    CaptureReceipt {
        job_id: entry.id.clone(),
        index,
        frame_count: accepted_count(entry, inner),
        stop_reason: inner.disk_stopped.then(|| "disk_space".into()),
        received_frames: inner.job.received_frames,
        bytes_spooled: inner.job.bytes_spooled,
    }
}
fn admit_disk(entry: &Entry, inner: &mut Inner, incoming: u64) -> Result<bool> {
    let available = match spool::disk::available(&entry.spool.dir) {
        Ok(available) => available,
        Err(e) => {
            let error = format!("Capture storage I/O failed: {e}");
            fail(entry, inner, error.clone());
            return Err(error);
        }
    };
    let needed = spool::disk::capture_requirement(inner.job.bytes_spooled, incoming)?;
    if available >= needed {
        return Ok(true);
    }
    if inner.job.received_frames == 0 {
        let error = "Destination disk is low on space; no accepted frames to save".to_owned();
        fail(entry, inner, error.clone());
        return Err(error);
    }
    inner.disk_stopped = true;
    inner.job.resolved_settings["stop_reason"] = json!("disk_space");
    inner.job.resolved_settings["accepted_frame_count"] = json!(accepted_count(entry, inner));
    inner
        .job
        .warnings
        .push("Capture stopped for disk space; exporting the accepted partial recording.".into());
    Ok(false)
}
