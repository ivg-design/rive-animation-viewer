use super::types::{io, Result};
use std::sync::{Arc, Mutex, OnceLock};

// Cache only successful initialization. Serialize retries and recheck after waiting.
pub(super) fn get_or_try_init<T>(
    cell: &OnceLock<Arc<T>>,
    gate: &Mutex<()>,
    initialize: impl FnOnce() -> Result<Arc<T>>,
) -> Result<Arc<T>> {
    if let Some(value) = cell.get() {
        return Ok(value.clone());
    }
    let _guard = gate.lock().map_err(io)?;
    if let Some(value) = cell.get() {
        return Ok(value.clone());
    }
    let value = initialize()?;
    Ok(cell.get_or_init(|| value).clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Barrier,
    };

    #[test]
    fn transient_failure_retries_and_concurrent_success_initializes_once() {
        let cell = OnceLock::new();
        let gate = Mutex::new(());
        let attempts = AtomicUsize::new(0);
        let failed = get_or_try_init::<usize>(&cell, &gate, || {
            attempts.fetch_add(1, Ordering::SeqCst);
            Err("transient journal I/O failure".into())
        });
        assert!(failed.is_err());
        assert!(cell.get().is_none());
        let start = Barrier::new(16);
        std::thread::scope(|scope| {
            let mut handles = Vec::new();
            for _ in 0..16 {
                handles.push(scope.spawn(|| {
                    start.wait();
                    get_or_try_init(&cell, &gate, || {
                        attempts.fetch_add(1, Ordering::SeqCst);
                        Ok(Arc::new(42))
                    })
                    .unwrap()
                }));
            }
            for handle in handles {
                let value = handle.join().unwrap();
                assert!(Arc::ptr_eq(&value, cell.get().unwrap()));
                assert_eq!(*value, 42);
            }
        });
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
        get_or_try_init(&cell, &gate, || panic!("cached success must not retry")).unwrap();
    }
}
