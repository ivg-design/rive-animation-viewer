use super::{
    discovery::Discovery,
    encode, gif,
    process::Control,
    spool::{self, Spool},
    types::*,
    verify,
};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    fs,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{atomic::Ordering, Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

#[path = "jobs/append.rs"]
mod append;
#[path = "jobs/recovery.rs"]
mod recovery;
#[path = "jobs/stream.rs"]
mod stream;
#[path = "jobs/worker.rs"]
mod worker;

struct Inner {
    job: Job,
    last_index: Option<u32>,
    disk_stopped: bool,
    stream: Option<stream::Stream>,
    touched: Instant,
}
struct Entry {
    id: String,
    request: BeginRequest,
    spool: Spool,
    control: Control,
    adapter: String,
    inner: Mutex<Inner>,
}
pub struct Backend {
    pub discovery: Discovery,
    entries: Mutex<VecDeque<Arc<Entry>>>,
}
fn terminal(state: &str) -> bool {
    ["completed", "cancelled", "failed"].contains(&state)
}
impl Backend {
    pub fn new(discovery: Discovery) -> Result<Arc<Self>> {
        spool::reap_abandoned()?;
        let backend = Arc::new(Self {
            discovery,
            entries: Mutex::new(VecDeque::new()),
        });
        let weak = Arc::downgrade(&backend);
        thread::Builder::new()
            .name("media-export-reaper".into())
            .spawn(move || loop {
                thread::sleep(Duration::from_secs(1));
                let Some(backend) = weak.upgrade() else { break };
                backend.expire();
            })
            .map_err(io)?;
        Ok(backend)
    }
    pub fn capabilities(&self) -> Value {
        self.discovery.capabilities.clone()
    }
    fn get(&self, id: &str) -> Result<Arc<Entry>> {
        uuid::Uuid::parse_str(id).map_err(|_| "Invalid media job ID")?;
        self.entries
            .lock()
            .map_err(io)?
            .iter()
            .find(|entry| entry.id == id)
            .cloned()
            .ok_or("Unknown or expired media job".into())
    }
    pub fn begin(&self, request: BeginRequest) -> Result<Job> {
        request.validate()?;
        let id_value = serde_json::to_value(request.format).map_err(io)?;
        let capabilities = &self.discovery.capabilities;
        let supported = capabilities["formats"]
            .as_array()
            .and_then(|formats| formats.iter().find(|f| f["id"] == id_value));
        if !supported.is_some_and(|f| f["available"] == true) {
            return Err(format!(
                "Requested encoder unavailable: {}",
                supported.map(|f| &f["reason"]).unwrap_or(&Value::Null)
            ));
        }
        let mut adapter = "ffmpeg".to_owned();
        let mut warnings = Vec::new();
        if request.format == Format::Gif {
            let gif = request.gif.clone().unwrap_or_default();
            adapter = if gif.encoder == "auto" {
                capabilities["gif"]["resolved_auto_encoder"]
                    .as_str()
                    .unwrap_or("ffmpeg")
                    .into()
            } else {
                gif.encoder
            };
            if capabilities["gif"][format!("{adapter}_available")] != true {
                return Err(format!("{adapter} GIF adapter unavailable"));
            }
            if adapter == "ffmpeg" && (gif.motion_quality.is_some() || gif.lossy_quality.is_some())
            {
                return Err(
                    "FFmpeg GIF does not support motion_quality or lossy_quality; select gifski"
                        .into(),
                );
            }
            if adapter == "ffmpeg" {
                warnings.push("GIF is using the explicit FFmpeg palette adapter; gifski quality controls are unavailable.".into());
            }
            warnings.push(
                "GIF has binary alpha and 10ms timing quantization; measured duration is returned."
                    .into(),
            );
        }
        let mut entries = self.entries.lock().map_err(io)?;
        if entries
            .iter()
            .any(|e| e.inner.lock().is_ok_and(|i| !terminal(&i.job.state)))
        {
            return Err(
                "A media job is already capturing or encoding; finish/cancel it first".into(),
            );
        }
        while entries.len() >= 32 {
            entries.pop_front();
        }
        let job_id = uuid::Uuid::new_v4().to_string();
        let spool = Spool::new(
            &job_id,
            request
                .output_path
                .as_deref()
                .ok_or("Output path required after save dialog")?,
            request.format,
            request.overwrite,
        )?;
        let stream = if request.capture_codec.is_some() {
            match stream::Stream::new(&spool, &request) {
                Ok(stream) => Some(stream),
                Err(error) => {
                    let _ = spool.clean();
                    return Err(error);
                }
            }
        } else {
            None
        };
        let job = Job {
            job_id,
            state: "capturing".into(),
            stage: "capturing".into(),
            received_frames: 0,
            frame_count: None,
            bytes_spooled: if request.capture_codec.as_deref() == Some("vp9") {
                32
            } else {
                0
            },
            output_path: Some(spool.output.to_string_lossy().into_owned()),
            actual_bytes: None,
            warnings,
            error: None,
            progress: 0.0,
            resolved_settings: json!({ "format": request.format, "width": request.width, "height": request.height,
                "fps": request.fps, "source_fps": request.fps, "source_identity": request.source_identity,
                "source_session": request.source_session, "encoder": adapter, "alpha": request.alpha,
                "background": request.background, "quality": request.quality, "capture_codec": request.capture_codec }),
        };
        entries.push_back(Arc::new(Entry {
            id: job.job_id.clone(),
            request,
            spool,
            control: Control::new(),
            adapter,
            inner: Mutex::new(Inner {
                job: job.clone(),
                last_index: None,
                disk_stopped: false,
                stream,
                touched: Instant::now(),
            }),
        }));
        Ok(job)
    }
    pub fn finish(self: &Arc<Self>, request: FinishRequest) -> Result<Job> {
        let entry = self.get(&request.job_id)?;
        let mut inner = entry.inner.lock().map_err(io)?;
        if inner.job.state != "capturing" {
            return Err("Job is not capturing".into());
        }
        if inner.job.received_frames == 0 {
            fail(&entry, &mut inner, "Cannot finish a zero-frame job".into());
            return Ok(inner.job.clone());
        }
        if inner.disk_stopped && request.frame_count != accepted_count(&entry, &inner) {
            return Err("Disk-stopped capture must finish at the accepted frame_count".into());
        }
        if entry.request.capture_codec.is_some() {
            if request.frame_count != inner.job.received_frames {
                fail(
                    &entry,
                    &mut inner,
                    "Encoded frame count mismatch; fast capture never inserts holds".into(),
                );
                return Ok(inner.job.clone());
            }
        } else if request.frame_count <= inner.last_index.ok_or("Missing frame")? {
            return Err("frame_count must include every received index".into());
        }
        if !entry.request.format.animated()
            && (request.frame_count != 1 || inner.job.received_frames != 1)
        {
            return Err("Still formats require exactly one frame".into());
        }
        if let Some(stream) = inner.stream.take() {
            if let Err(error) = stream.finish() {
                fail(
                    &entry,
                    &mut inner,
                    format!("Capture storage I/O failed: {error}"),
                );
                return Ok(inner.job.clone());
            }
        }
        inner.job.frame_count = Some(request.frame_count);
        inner.job.state = "encoding".into();
        inner.job.stage = "preparing".into();
        inner.job.resolved_settings["capture_seconds"] =
            json!(entry.control.born.elapsed().as_secs_f64());
        inner.job.progress = 0.05;
        let held = request.frame_count - inner.job.received_frames;
        if held > 0 {
            inner.job.warnings.push(format!(
                "{held} presentation frames hold preceding captures; duration is preserved."
            ));
        }
        let response = inner.job.clone();
        let worker_entry = entry.clone();
        let backend = self.clone();
        if let Err(e) = thread::Builder::new()
            .name("media-export-encoder".into())
            .spawn(move || {
                let result = catch_unwind(AssertUnwindSafe(|| {
                    backend.encode(&worker_entry, request.frame_count)
                }))
                .unwrap_or_else(|_| Err("Media encoder worker panicked".into()));
                if let Err(e) = result {
                    if let Ok(mut inner) = worker_entry.inner.lock() {
                        fail(&worker_entry, &mut inner, e);
                    }
                }
            })
        {
            fail(&entry, &mut inner, io(e));
            return Ok(inner.job.clone());
        }
        Ok(response)
    }
    pub fn status(&self, id: &str) -> Result<Job> {
        Ok(self.get(id)?.inner.lock().map_err(io)?.job.clone())
    }
    pub fn cancel(&self, id: &str) -> Result<Job> {
        let entry = self.get(id)?;
        let mut inner = entry.inner.lock().map_err(io)?;
        if !terminal(&inner.job.state) {
            entry.control.cancel.store(true, Ordering::SeqCst);
            if inner.job.state == "capturing" {
                fail(&entry, &mut inner, "Cancelled".into());
            } else if !inner
                .job
                .warnings
                .iter()
                .any(|s| s == "Cancellation requested; waiting for encoder cleanup.")
            {
                inner
                    .job
                    .warnings
                    .push("Cancellation requested; waiting for encoder cleanup.".into());
            }
        }
        Ok(inner.job.clone())
    }
    fn expire(&self) {
        let Ok(entries) = self.entries.lock() else {
            return;
        };
        for entry in entries.iter() {
            let Ok(mut inner) = entry.inner.try_lock() else {
                continue;
            };
            if inner.job.state == "capturing"
                && (inner.touched.elapsed().as_secs() > 120 || entry.control.check().is_err())
            {
                let error = "Capture expired: idle watchdog reached".to_owned();
                if inner.job.received_frames > 0 && !entry.control.cancel.load(Ordering::SeqCst) {
                    // An unresponsive producer is not user cancellation or invalid media.
                    inner.job.state = "failed".into();
                    inner.job.stage = "failed".into();
                    inner.job.error = Some(error);
                    recovery::retain(entry, &mut inner, true);
                } else {
                    fail(entry, &mut inner, error);
                }
            }
        }
    }
}
fn fail(entry: &Entry, inner: &mut Inner, error: String) {
    let cancelled = entry.control.cancel.load(Ordering::SeqCst);
    let capture = inner.job.state == "capturing";
    // A failed finalization must not erase the user's accepted source. This also
    // covers adapter bounds, unavailable encoders, and failed output verification.
    let finalizing = inner.job.state == "encoding";
    let retain = !cancelled
        && inner.job.received_frames > 0
        && (finalizing || recovery::storage_error(&error));
    inner.job.state = if cancelled { "cancelled" } else { "failed" }.into();
    inner.job.stage = inner.job.state.clone();
    inner.job.error = Some(error);
    if retain {
        recovery::retain(entry, inner, capture);
    } else {
        inner.stream.take(); // Close before cleanup, including on Windows.
        if let Err(e) = entry.spool.clean() {
            inner
                .job
                .warnings
                .push(format!("Spool cleanup failed: {e}"));
        }
    }
}

fn accepted_count(entry: &Entry, inner: &Inner) -> u32 {
    if entry.request.capture_codec.is_some() {
        inner.job.received_frames
    } else {
        inner.last_index.map_or(0, |index| index + 1)
    }
}
