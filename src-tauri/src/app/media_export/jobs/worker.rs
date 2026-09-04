use super::*;

impl Backend {
    pub(super) fn encode(&self, entry: &Arc<Entry>, count: u32) -> Result<()> {
        let binaries = self
            .discovery
            .binaries
            .as_ref()
            .ok_or("Encoder unavailable")?;
        let encode_started = Instant::now();
        entry.inner.lock().map_err(io)?.job.stage = "encoding".into();
        let weak = Arc::downgrade(entry);
        let control = Control {
            cancel: entry.control.cancel.clone(),
            born: entry.control.born,
            progress: Some(Arc::new(move |frame| {
                if let Some(entry) = weak.upgrade() {
                    if let Ok(mut inner) = entry.inner.lock() {
                        inner.job.progress = inner
                            .job
                            .progress
                            .max((0.05 + 0.80 * frame / count as f64).min(0.85));
                    }
                }
            })),
        };
        let (candidate, settings) = if entry.request.capture_codec.is_some() {
            stream::remux(binaries, &entry.request, &entry.spool, count, &control)?
        } else if entry.request.format == Format::Gif {
            let adapter = gif::bounded_adapter(&entry.request, &entry.adapter, count)?;
            if adapter != entry.adapter {
                if self.discovery.capabilities["gif"]["ffmpeg_available"] != true {
                    return Err("Long GIF needs the unavailable FFmpeg adapter".into());
                }
                entry.inner.lock().map_err(io)?.job.warnings.push(
                    "Long GIF auto-selected FFmpeg to avoid gifski's platform argument bound."
                        .into(),
                );
            }
            gif::encode(
                binaries,
                &entry.request,
                &entry.spool,
                &[],
                count,
                &adapter,
                &control,
            )?
        } else {
            encode::ordinary(binaries, &entry.request, &entry.spool, &[], count, &control)?
        };
        let expected_count = settings["frame_count"]
            .as_u64()
            .ok_or("Missing resolved count")? as u32;
        {
            let mut inner = entry.inner.lock().map_err(io)?;
            inner.job.resolved_settings["encode_seconds"] =
                json!(encode_started.elapsed().as_secs_f64());
            inner.job.stage = "verifying".into();
            inner.job.progress = 0.90;
        }
        let verify_started = Instant::now();
        let weak = Arc::downgrade(entry);
        let verification = Control {
            cancel: entry.control.cancel.clone(),
            born: entry.control.born,
            progress: Some(Arc::new(move |frame| {
                if let Some(entry) = weak.upgrade() {
                    if let Ok(mut inner) = entry.inner.lock() {
                        inner.job.progress = inner
                            .job
                            .progress
                            .max((0.90 + 0.09 * frame / expected_count.max(1) as f64).min(0.99));
                    }
                }
            })),
        };
        let receipt = verify::inspect(
            binaries,
            &candidate,
            verify::ExpectedOutput {
                format: entry.request.format,
                width: settings["width"].as_u64().ok_or("Missing resolved width")? as u32,
                height: settings["height"]
                    .as_u64()
                    .ok_or("Missing resolved height")? as u32,
                frame_count: expected_count,
                duration: count as f64 / entry.request.fps.value(),
                rate: entry.request.fps.value(),
            },
            &verification,
        )?;
        {
            let mut inner = entry.inner.lock().map_err(io)?;
            inner.job.resolved_settings["verify_seconds"] =
                json!(verify_started.elapsed().as_secs_f64());
            inner.job.stage = "publishing".into();
            inner.job.progress = 0.99;
        }
        // Cancellation and publication are serialized. If publish won, cancel returns completed.
        let mut inner = entry.inner.lock().map_err(io)?;
        control.check()?;
        let size = entry
            .spool
            .publish(&candidate, entry.request.overwrite)
            .map_err(|e| format!("Output publication failed: {e}"))?;
        inner.job.actual_bytes = Some(size);
        inner.job.state = "completed".into();
        inner.job.stage = "completed".into();
        inner.job.progress = 1.0;
        if settings["target_met"] == false {
            inner.job.warnings.push("GIF target size was not met after at most five attempts; smallest achieved output published without shortening duration.".into());
        }
        if let (Some(existing), Some(resolved)) = (
            inner.job.resolved_settings.as_object_mut(),
            settings.as_object(),
        ) {
            existing.extend(resolved.clone());
            existing.insert("verification".into(), receipt);
            existing.insert(
                "encoders".into(),
                self.discovery.capabilities["encoders"].clone(),
            );
        }
        if let Err(e) = entry.spool.clean() {
            inner
                .job
                .warnings
                .push(format!("Output complete; spool cleanup needs retry: {e}"));
        }
        Ok(())
    }
}
