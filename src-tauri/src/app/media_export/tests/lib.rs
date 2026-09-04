//! Compiles the actual native backend sources without Tauri/main/Cargo registration.
#[path = "../discovery.rs"]
pub mod discovery;
#[path = "../encode.rs"]
pub mod encode;
#[path = "../gif.rs"]
pub mod gif;
#[path = "../jobs.rs"]
pub mod jobs;
#[path = "../process.rs"]
pub mod process;
#[cfg(test)]
mod smoke;
#[path = "../spool.rs"]
pub mod spool;
#[path = "../types.rs"]
pub mod types;
#[cfg(test)]
mod unit;
#[path = "../verify.rs"]
pub mod verify;

#[cfg(test)]
#[path = "streaming/smoke.rs"]
mod streaming_smoke;
#[cfg(test)]
#[path = "streaming/unit.rs"]
mod streaming_unit;

#[cfg(test)]
#[path = "../init.rs"]
mod init;
