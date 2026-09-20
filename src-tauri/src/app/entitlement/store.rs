//! Persistence for a machine-bound entitlement key.
//!
//! Pure helpers over an explicit directory so callers (the Tauri commands) can
//! pass the app data directory in production and a temp directory in tests.
//! The stored file holds only the raw token text; verification always goes
//! back through `super::verify`, so a corrupted or foreign-bound file is
//! simply treated as "no valid key" rather than trusted blindly.

use std::path::{Path, PathBuf};

const KEY_FILE_NAME: &str = "entitlement.key";

pub fn key_path(dir: &Path) -> PathBuf {
    dir.join(KEY_FILE_NAME)
}

pub fn load(dir: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(key_path(dir)).ok()?;
    let trimmed = raw.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_owned())
}

pub fn save(dir: &Path, token: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("Failed to create {}: {}", dir.display(), error))?;
    let path = key_path(dir);
    std::fs::write(&path, token.trim())
        .map_err(|error| format!("Failed to write {}: {}", path.display(), error))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(&path, permissions).map_err(|error| {
            format!("Failed to set permissions on {}: {}", path.display(), error)
        })?;
    }
    Ok(())
}

pub fn clear(dir: &Path) {
    let _ = std::fs::remove_file(key_path(dir));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("rav-entitlement-store-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn round_trips_a_saved_token() {
        let dir = temp_dir();
        assert_eq!(load(&dir), None);
        save(&dir, "RAVK1.a.b").unwrap();
        assert_eq!(load(&dir), Some("RAVK1.a.b".to_string()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(key_path(&dir))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clear_removes_the_key_file() {
        let dir = temp_dir();
        save(&dir, "RAVK1.a.b").unwrap();
        clear(&dir);
        assert_eq!(load(&dir), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
