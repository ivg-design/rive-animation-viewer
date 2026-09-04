//! Bounded subprocess execution. No shell, PATH lookup, caller-supplied arguments or stdin.
use super::types::*;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

#[path = "process/output.rs"]
mod output;
use output::{Activity, Lines};

pub struct Control {
    pub cancel: Arc<AtomicBool>,
    pub born: Instant,
    pub progress: Option<Arc<dyn Fn(f64) + Send + Sync>>,
}
impl Control {
    pub fn new() -> Self {
        Self {
            cancel: Arc::new(AtomicBool::new(false)),
            born: Instant::now(),
            progress: None,
        }
    }
    pub fn check(&self) -> Result<()> {
        if self.cancel.load(Ordering::SeqCst) {
            return Err("Cancelled".into());
        }
        Ok(())
    }
}

impl Default for Control {
    fn default() -> Self {
        Self::new()
    }
}
fn rss(child: &std::process::Child) -> Result<u64> {
    #[cfg(not(target_os = "windows"))]
    let pid = child.id();
    #[cfg(target_os = "windows")]
    {
        use std::{ffi::c_void, os::windows::io::AsRawHandle};
        // PROCESS_MEMORY_COUNTERS: DWORD cb/faults, followed by eight SIZE_T fields.
        #[repr(C)]
        struct Counters {
            cb: u32,
            faults: u32,
            sizes: [usize; 8],
        }
        #[link(name = "psapi")]
        extern "system" {
            fn GetProcessMemoryInfo(
                process: *mut c_void,
                counters: *mut Counters,
                size: u32,
            ) -> i32;
        }
        let size = std::mem::size_of::<Counters>() as u32;
        let mut counters = Counters {
            cb: size,
            faults: 0,
            sizes: [0; 8],
        };
        // SAFETY: Child owns a live process handle; repr(C) storage has the documented size.
        if unsafe { GetProcessMemoryInfo(child.as_raw_handle(), &mut counters, size) } == 0 {
            return Err(format!(
                "Windows encoder memory query failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        // Bound both current resident pages and private commit rather than swapped-out RSS alone.
        return Ok(counters.sizes[1].max(counters.sizes[6]) as u64);
    }
    #[cfg(target_os = "macos")]
    {
        let result = Command::new("/bin/ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .map_err(io)?;
        if !result.status.success() {
            return Ok(0);
        } // Child may have just exited.
        String::from_utf8_lossy(&result.stdout)
            .trim()
            .parse::<u64>()
            .map(|kb| kb * 1024)
            .map_err(io)
    }
    #[cfg(target_os = "linux")]
    {
        let status = match fs::read_to_string(format!("/proc/{pid}/status")) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(io(e)),
        };
        return status
            .lines()
            .find(|l| l.starts_with("VmRSS:"))
            .and_then(|l| l.split_whitespace().nth(1))
            .unwrap_or("0")
            .parse::<u64>()
            .map(|kb| kb * 1024)
            .map_err(io);
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = pid;
        Err("Native memory supervision is unavailable on this platform".into())
    }
}
pub fn run(
    binary: &Path,
    args: &[String],
    cwd: Option<&Path>,
    control: &Control,
    timeout: u64,
    watched: &[PathBuf],
) -> Result<Vec<u8>> {
    run_inner(binary, args, cwd, control, timeout, watched, None)
}
pub fn run_lines(
    binary: &Path,
    args: &[String],
    control: &Control,
    idle_seconds: u64,
    lines: Arc<dyn Fn(&str) + Send + Sync>,
) -> Result<()> {
    run_inner(binary, args, None, control, idle_seconds, &[], Some(lines)).map(|_| ())
}
fn run_inner(
    binary: &Path,
    args: &[String],
    cwd: Option<&Path>,
    control: &Control,
    idle_seconds: u64,
    watched: &[PathBuf],
    lines: Option<Lines>,
) -> Result<Vec<u8>> {
    control.check()?;
    let mut command = Command::new(binary);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW; Child::kill uses TerminateProcess.
    }
    command
        .env_clear()
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("RAYON_NUM_THREADS", "2")
        .env("OMP_NUM_THREADS", "2")
        .env("LC_ALL", "C");
    // Windows loaders need SystemRoot; never inherit arbitrary encoder/plugin search paths.
    #[cfg(windows)]
    if let Some(root) = std::env::var_os("SystemRoot") {
        command.env("SystemRoot", root);
    }
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("Cannot start encoder: {e}"))?;
    let stdout = child.stdout.take().ok_or("Missing child stdout")?;
    let stderr = child.stderr.take().ok_or("Missing child stderr")?;
    let progress = control.progress.clone();
    let activity = Arc::new(Activity::new());
    let output_activity = activity.clone();
    let progress_output = args
        .windows(2)
        .any(|pair| pair[0] == "-progress" && pair[1] == "pipe:1");
    let out = thread::spawn(move || {
        output::drain(
            stdout,
            1_048_576,
            progress,
            lines,
            Some(output_activity),
            progress_output,
        )
    });
    // Repeated error logging is not evidence of useful progress.
    let err = thread::spawn(move || output::drain(stderr, 16_384, None, None, None, false));
    let mut signatures = vec![None; watched.len()];
    let mut sampled = Instant::now() - Duration::from_secs(1);
    let status = loop {
        let check = control.check().and_then(|_| {
            if sampled.elapsed() >= Duration::from_millis(500) {
                sampled = Instant::now();
                for (path, previous) in watched.iter().zip(signatures.iter_mut()) {
                    let meta = fs::metadata(path).ok();
                    let signature = meta.as_ref().map(|m| (m.len(), m.modified().ok()));
                    if signature != *previous {
                        activity.mark();
                        *previous = signature;
                    }
                    let volume_path = if meta.is_some() {
                        path.as_path()
                    } else {
                        path.parent().ok_or("Missing destination parent")?
                    };
                    super::spool::disk::ensure_finalization(volume_path, 0)?;
                }
                if rss(&child)? > MAX_RSS {
                    return Err("Encoder memory limit exceeded".into());
                }
            }
            if activity.idle(idle_seconds) {
                return Err("Encoder inactivity timeout".into());
            }
            Ok(())
        });
        if let Err(e) = check {
            let _ = child.kill();
            let _ = child.wait();
            break Err(e);
        }
        match child.try_wait() {
            Ok(Some(s)) => break Ok(s),
            Ok(None) => thread::sleep(Duration::from_millis(40)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(io(e));
            }
        }
    };
    let stdout = out
        .join()
        .map_err(|_| "Output reader panicked")?
        .map_err(io)?;
    let stderr = err
        .join()
        .map_err(|_| "Error reader panicked")?
        .map_err(io)?;
    let status = status?;
    if !status.success() {
        return Err(format!(
            "Encoder exited {status}: {}",
            String::from_utf8_lossy(&stderr)
        ));
    }
    control.check()?;
    for path in watched {
        let volume_path = if path.exists() {
            path.as_path()
        } else {
            path.parent().ok_or("Missing destination parent")?
        };
        super::spool::disk::ensure_finalization(volume_path, 0)?;
    }
    Ok(stdout)
}
pub fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|s| (*s).to_owned()).collect()
}
pub fn owner_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    #[cfg(unix)]
    {
        extern "C" {
            fn kill(pid: i32, signal: i32) -> i32;
        }
        if pid > i32::MAX as u32 {
            return false;
        }
        // SAFETY: signal zero probes existence only; it never signals the process.
        (unsafe { kill(pid as i32, 0) }) == 0
            || std::io::Error::last_os_error().raw_os_error() != Some(3)
    }
    #[cfg(windows)]
    {
        use std::ffi::c_void;
        #[link(name = "kernel32")]
        extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
            fn GetExitCodeProcess(process: *mut c_void, code: *mut u32) -> i32;
            fn CloseHandle(handle: *mut c_void) -> i32;
        }
        // SAFETY: query-only handle is checked for null and closed exactly once.
        unsafe {
            let handle = OpenProcess(0x1000, 0, pid);
            if handle.is_null() {
                return std::io::Error::last_os_error().raw_os_error() != Some(87);
            }
            let mut code = 259;
            let ok = GetExitCodeProcess(handle, &mut code);
            CloseHandle(handle);
            return ok == 0 || code == 259;
        }
    }
    #[cfg(not(any(unix, windows)))]
    {
        true
    }
}
