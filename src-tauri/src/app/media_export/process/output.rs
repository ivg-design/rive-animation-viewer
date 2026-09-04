use super::*;
use std::sync::Mutex;

pub(super) type Lines = Arc<dyn Fn(&str) + Send + Sync>;
pub(super) struct Activity(Mutex<Instant>);
impl Activity {
    pub(super) fn new() -> Self {
        Self(Mutex::new(Instant::now()))
    }
    pub(super) fn mark(&self) {
        if let Ok(mut time) = self.0.lock() {
            *time = Instant::now();
        }
    }
    pub(super) fn idle(&self, seconds: u64) -> bool {
        self.0
            .lock()
            .map_or(true, |time| time.elapsed() >= Duration::from_secs(seconds))
    }
}
pub(super) fn drain(
    mut stream: impl Read,
    limit: usize,
    progress: Option<Arc<dyn Fn(f64) + Send + Sync>>,
    lines: Option<Lines>,
    activity: Option<Arc<Activity>>,
    progress_output: bool,
) -> std::io::Result<Vec<u8>> {
    let mut result = Vec::new();
    let mut buf = [0u8; 8192];
    let mut pending = String::new();
    let mut last_frame = -1.0;
    loop {
        let n = stream.read(&mut buf)?;
        if n == 0 {
            break;
        }
        if progress_output {
            // Keep the end, not the beginning, so arbitrarily long jobs retain progress=end.
            let excess = result.len().saturating_add(n).saturating_sub(limit);
            if excess > 0 {
                result.drain(..excess);
            }
            result.extend_from_slice(&buf[..n]);
        } else {
            let remaining = limit.saturating_sub(result.len());
            result.extend_from_slice(&buf[..n.min(remaining)]);
            if let Some(activity) = &activity {
                activity.mark();
            }
        }
        if progress_output || lines.is_some() {
            pending.push_str(&String::from_utf8_lossy(&buf[..n]));
            while let Some(end) = pending.find('\n') {
                let line = pending[..end].trim_end_matches('\r');
                if let Some(callback) = &lines {
                    callback(line);
                }
                if progress_output {
                    if let Some(frame) = line
                        .strip_prefix("frame=")
                        .and_then(|f| f.trim().parse::<f64>().ok())
                    {
                        if frame.is_finite() && frame > last_frame {
                            last_frame = frame;
                            if let Some(activity) = &activity {
                                activity.mark();
                            }
                            if let Some(callback) = &progress {
                                callback(frame);
                            }
                        }
                    }
                }
                pending.drain(..=end);
            }
            if pending.len() > 16_384 {
                return Err(std::io::Error::other("Oversized encoder output line"));
            }
        }
    }
    if !pending.is_empty() {
        if let Some(callback) = &lines {
            callback(&pending);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn long_progress_keeps_final_count_in_bounded_tail() {
        let mut source = String::new();
        for frame in 0..70_000 {
            source.push_str(&format!("frame={frame}\nprogress=continue\n"));
        }
        source.push_str("frame=70000\nprogress=end\n");
        assert!(source.len() > 1_048_576);
        let tail = drain(
            std::io::Cursor::new(source),
            1_048_576,
            None,
            None,
            None,
            true,
        )
        .unwrap();
        assert_eq!(tail.len(), 1_048_576);
        assert_eq!(
            super::super::super::verify::decoded_count(&tail, Format::H264, 70_000).unwrap(),
            70_000
        );
    }
    #[test]
    fn activity_watchdog_resets_on_progress_not_total_job_age() {
        let activity = Activity(Mutex::new(Instant::now() - Duration::from_secs(1200)));
        assert!(activity.idle(600));
        activity.mark();
        assert!(!activity.idle(600));
    }
}
