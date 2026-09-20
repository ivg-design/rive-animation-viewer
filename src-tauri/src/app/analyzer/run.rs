//! Subprocess execution for the `rfa` sidecar: writes the inspection JSON to
//! a scratch file, runs `rfa report`, bounds its output, enforces a timeout,
//! and verifies the reports it was asked to produce actually landed.

use super::{AnalyzerIssueCounts, AnalyzerOutput, AnalyzerRunReport, AnalyzerSummary};
use regex::Regex;
use std::io::Read;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(180);
const OUTPUT_CAP_BYTES: usize = 8 * 1024;

pub fn execute(
    sidecar: &Path,
    inspection: &serde_json::Value,
    formats: &[String],
    output_dir: &Path,
    title: Option<&str>,
    stem: &str,
) -> Result<AnalyzerRunReport, String> {
    let started = Instant::now();
    let work_dir = std::env::temp_dir().join(format!(
        "rav-analyzer-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&work_dir)
        .map_err(|error| format!("Failed to create a temporary analyzer directory: {error}"))?;

    let input_path = work_dir.join(format!("{stem}.json"));
    if let Err(error) = write_inspection(&input_path, inspection) {
        let _ = std::fs::remove_dir_all(&work_dir);
        return Err(error);
    }

    let mut command = Command::new(sidecar);
    command
        .arg("report")
        .arg(&input_path)
        .arg("--out")
        .arg(output_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for format in formats {
        command.arg(format!("--{format}"));
    }
    if let Some(title) = title {
        command.arg("--title").arg(title);
    }

    let child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&work_dir);
            return Err(format!("Failed to launch the analyzer: {error}"));
        }
    };

    let run_result = run_with_timeout(child, TIMEOUT);
    let _ = std::fs::remove_dir_all(&work_dir);
    let (succeeded, stdout, stderr) = run_result?;

    if !succeeded {
        let message = if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else if !stdout.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            "The analyzer exited with a failure and produced no output".to_string()
        };
        return Err(message);
    }

    // `rfa` logs its per-file "wrote ..." lines and the one-line summary to
    // stderr (stdout is reserved for future machine-readable output), so
    // check stderr first and fall back to stdout for forward compatibility.
    let summary_line = stderr
        .lines()
        .rev()
        .find(|line| line.contains("rules ran"))
        .or_else(|| stdout.lines().rev().find(|line| line.contains("rules ran")))
        .unwrap_or("")
        .trim()
        .to_string();
    let summary = parse_summary_line(&summary_line);

    let mut outputs = Vec::with_capacity(formats.len());
    for format in formats {
        let path = output_dir.join(format!("{stem}.report.{}", expected_extension(format)));
        let metadata = std::fs::metadata(&path).map_err(|error| {
            format!(
                "Expected analyzer output was not created: {} ({error})",
                path.display()
            )
        })?;
        if metadata.len() == 0 {
            return Err(format!("Analyzer output is empty: {}", path.display()));
        }
        outputs.push(AnalyzerOutput {
            format: format.clone(),
            path: path.to_string_lossy().to_string(),
            bytes: metadata.len(),
        });
    }

    Ok(AnalyzerRunReport {
        outputs,
        summary,
        summary_line,
        duration_ms: started.elapsed().as_millis(),
    })
}

fn write_inspection(path: &Path, inspection: &serde_json::Value) -> Result<(), String> {
    let bytes = serde_json::to_vec(inspection)
        .map_err(|error| format!("Failed to encode inspection JSON: {error}"))?;
    std::fs::write(path, bytes)
        .map_err(|error| format!("Failed to write a temporary inspection file: {error}"))
}

/// The report filename extension `rfa` uses for a given `--<format>` flag.
pub(crate) fn expected_extension(format: &str) -> &'static str {
    match format {
        "md" => "md",
        "html" => "html",
        "pdf" => "pdf",
        _ => "bin",
    }
}

/// Runs `child` to completion, killing it if it outruns `timeout`. Reader
/// threads drain stdout/stderr concurrently (bounded to `OUTPUT_CAP_BYTES`
/// each) so a full pipe buffer can never stall the child while it is waited
/// on from a dedicated thread.
fn run_with_timeout(mut child: Child, timeout: Duration) -> Result<(bool, String, String), String> {
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let pid = child.id();

    let stdout_handle = thread::spawn(move || read_capped(stdout_pipe));
    let stderr_handle = thread::spawn(move || read_capped(stderr_pipe));

    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let status = child.wait();
        let _ = tx.send(status);
    });

    let wait_result = rx.recv_timeout(timeout);
    let timed_out = matches!(wait_result, Err(RecvTimeoutError::Timeout));
    if timed_out {
        kill_pid(pid);
    }

    let stdout = stdout_handle.join().unwrap_or_default();
    let stderr = stderr_handle.join().unwrap_or_default();

    if timed_out {
        return Err(format!(
            "The analyzer timed out after {} seconds",
            timeout.as_secs()
        ));
    }

    match wait_result {
        Ok(Ok(status)) => Ok((status.success(), stdout, stderr)),
        Ok(Err(error)) => Err(format!("Failed to wait for the analyzer process: {error}")),
        Err(RecvTimeoutError::Disconnected) => {
            Err("The analyzer process disappeared before reporting a status".to_string())
        }
        Err(RecvTimeoutError::Timeout) => unreachable!("handled above"),
    }
}

fn kill_pid(pid: u32) {
    #[cfg(unix)]
    {
        let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/PID", &pid.to_string()])
            .status();
    }
}

fn read_capped(pipe: Option<impl Read>) -> String {
    let Some(mut pipe) = pipe else {
        return String::new();
    };
    let mut buffer = Vec::with_capacity(OUTPUT_CAP_BYTES.min(4096));
    let mut chunk = [0u8; 4096];
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                let remaining = OUTPUT_CAP_BYTES.saturating_sub(buffer.len());
                if remaining > 0 {
                    buffer.extend_from_slice(&chunk[..read.min(remaining)]);
                }
                // Keep draining past the cap so a chatty child never blocks
                // on a full pipe; the excess is simply discarded.
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&buffer).into_owned()
}

fn summary_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r"(?i)(\d+)\s+rules ran,\s*(\d+)\s+skipped;\s*issues:\s*(\d+)\s+error,\s*(\d+)\s+warning,\s*(\d+)\s+review,\s*(\d+)\s+info;\s*health\s+(\d+)",
        )
        .expect("valid summary line pattern")
    })
}

/// Tolerantly parses `rfa`'s one-line stdout summary, e.g.
/// `45 rules ran, 44 skipped; issues: 0 error, 1 warning, 0 review, 0 info; health 100`.
/// Any field that cannot be matched comes back as `None` rather than
/// failing the whole run — the report was already written successfully.
pub(crate) fn parse_summary_line(line: &str) -> AnalyzerSummary {
    let Some(captures) = summary_pattern().captures(line) else {
        return AnalyzerSummary::default();
    };
    let field = |index: usize| {
        captures
            .get(index)
            .and_then(|value| value.as_str().parse::<u64>().ok())
    };
    AnalyzerSummary {
        rules_ran: field(1),
        rules_skipped: field(2),
        issues: AnalyzerIssueCounts {
            error: field(3),
            warning: field(4),
            review: field(5),
            info: field(6),
        },
        health: field(7),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_well_formed_summary_line() {
        let summary = parse_summary_line(
            "45 rules ran, 44 skipped; issues: 0 error, 1 warning, 0 review, 0 info; health 100",
        );
        assert_eq!(summary.rules_ran, Some(45));
        assert_eq!(summary.rules_skipped, Some(44));
        assert_eq!(summary.issues.error, Some(0));
        assert_eq!(summary.issues.warning, Some(1));
        assert_eq!(summary.issues.review, Some(0));
        assert_eq!(summary.issues.info, Some(0));
        assert_eq!(summary.health, Some(100));
    }

    #[test]
    fn unparsable_lines_come_back_as_all_null() {
        let summary = parse_summary_line("rfa: nothing useful here");
        assert_eq!(summary, AnalyzerSummary::default());
        assert!(summary.rules_ran.is_none());
        assert!(summary.health.is_none());
    }

    #[test]
    fn empty_line_is_tolerated() {
        assert_eq!(parse_summary_line(""), AnalyzerSummary::default());
    }

    #[test]
    fn expected_extension_maps_known_formats_and_falls_back() {
        assert_eq!(expected_extension("md"), "md");
        assert_eq!(expected_extension("html"), "html");
        assert_eq!(expected_extension("pdf"), "pdf");
        assert_eq!(expected_extension("unknown"), "bin");
    }
}
