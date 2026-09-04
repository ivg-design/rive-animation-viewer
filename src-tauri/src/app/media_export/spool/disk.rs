//! Available bytes on the destination volume, not logical sizes of hard-linked files.
use super::super::types::*;
use std::path::Path;

// Incoming bytes are spent once on capture and budgeted again in the final copy.
pub fn capture_requirement(spooled: u64, incoming: u64) -> Result<u64> {
    spooled
        .checked_add(incoming)
        .and_then(|n| n.checked_add(incoming))
        .and_then(|n| n.checked_add(DISK_RESERVE))
        .ok_or("Disk requirement overflow".into())
}
pub fn require_available(available: u64, incoming: u64) -> Result<()> {
    let needed = DISK_RESERVE
        .checked_add(incoming)
        .ok_or("Disk requirement overflow")?;
    if available < needed {
        return Err("Destination disk is low on space (128 MiB reserve)".into());
    }
    Ok(())
}
// Finalization may consume the capture reservation for container overhead; retain 8 MiB emergency space.
pub const FINAL_RESERVE: u64 = 8 * 1024 * 1024;
pub fn ensure_finalization(path: &Path, incoming: u64) -> Result<()> {
    let needed = FINAL_RESERVE
        .checked_add(incoming)
        .ok_or("Disk requirement overflow")?;
    if available(path)? < needed {
        return Err("Destination disk is low on space during finalization".into());
    }
    Ok(())
}
pub fn ensure(path: &Path, incoming: u64) -> Result<()> {
    require_available(available(path)?, incoming)
}
pub fn available(path: &Path) -> Result<u64> {
    #[cfg(test)]
    if let Some(bytes) = TEST_AVAILABLE.with(|value| value.get()) {
        return Ok(bytes);
    }
    let volume = if path.is_dir() {
        path
    } else {
        path.parent().ok_or("Missing destination parent")?
    };
    platform_available(volume)
}

// Layouts checked against the Darwin SDK and the 64-bit GNU libc statvfs ABI.
#[cfg(any(
    target_os = "macos",
    all(
        target_os = "linux",
        target_env = "gnu",
        target_pointer_width = "64",
        any(target_arch = "aarch64", target_arch = "x86_64")
    )
))]
fn platform_available(path: &Path) -> Result<u64> {
    use std::{
        ffi::{c_char, CString},
        os::unix::ffi::OsStrExt,
    };
    #[cfg(target_os = "macos")]
    type Blocks = u32; // Darwin fsblkcnt_t/fsfilcnt_t are unsigned int, even on LP64.
    #[cfg(target_os = "linux")]
    type Blocks = u64;
    #[repr(C)]
    struct StatVfs {
        bsize: u64,
        frsize: u64,
        blocks: Blocks,
        bfree: Blocks,
        bavail: Blocks,
        files: Blocks,
        ffree: Blocks,
        favail: Blocks,
        fsid: u64,
        flag: u64,
        namemax: u64,
        #[cfg(target_os = "linux")]
        spare: [i32; 6],
    }
    extern "C" {
        fn statvfs(path: *const c_char, value: *mut StatVfs) -> i32;
    }
    let path = CString::new(path.as_os_str().as_bytes()).map_err(io)?;
    let mut value = std::mem::MaybeUninit::<StatVfs>::zeroed();
    // SAFETY: NUL-terminated path and correctly sized/aligned platform ABI storage.
    if unsafe { statvfs(path.as_ptr(), value.as_mut_ptr()) } != 0 {
        return Err(format!(
            "Cannot query destination disk: {}",
            std::io::Error::last_os_error()
        ));
    }
    let value = unsafe { value.assume_init() };
    (value.bavail as u64)
        .checked_mul(value.frsize)
        .ok_or("Disk space query overflow".into())
}
#[cfg(windows)]
fn platform_available(path: &Path) -> Result<u64> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDiskFreeSpaceExW(
            path: *const u16,
            available: *mut u64,
            total: *mut u64,
            free: *mut u64,
        ) -> i32;
    }
    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    if wide.contains(&0) {
        return Err("Invalid destination path".into());
    }
    wide.push(0);
    let mut available = 0;
    // SAFETY: terminated UTF-16 and writable u64; unused optional outputs are null.
    if unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut available,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(format!(
            "Cannot query destination disk: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(available)
}
#[cfg(not(any(
    target_os = "macos",
    windows,
    all(
        target_os = "linux",
        target_env = "gnu",
        target_pointer_width = "64",
        any(target_arch = "aarch64", target_arch = "x86_64")
    )
)))]
fn platform_available(_: &Path) -> Result<u64> {
    Err("Destination disk queries unsupported on this platform".into())
}

#[cfg(test)]
thread_local! { static TEST_AVAILABLE: std::cell::Cell<Option<u64>> = const { std::cell::Cell::new(None) }; }
#[cfg(test)]
pub fn with_available<T>(bytes: u64, f: impl FnOnce() -> T) -> T {
    struct Reset(Option<u64>);
    impl Drop for Reset {
        fn drop(&mut self) {
            TEST_AVAILABLE.with(|value| value.set(self.0));
        }
    }
    let _reset = Reset(TEST_AVAILABLE.with(|value| value.replace(Some(bytes))));
    f()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn available_space_override_is_scoped_to_the_callback() {
        let observed = with_available(42, || available(Path::new(".")).unwrap());
        assert_eq!(observed, 42);
    }
}
