//! Crash recovery: while a label has unsaved changes, the frontend keeps a copy of it
//! here, in the app's data folder. If Labelgood ends without saving or discarding those
//! changes (a crash, power loss, a killed process), the next start offers to restore it.
//!
//! Every running instance is a session with its own files:
//! - `<session>.labelgood`: the unsaved label
//! - `<session>.json`: the file it belongs to, if it has one
//! - `<session>.lock`: held with an exclusive lock for as long as the instance runs
//!
//! The operating system releases the lock when the process ends, however it ends. So
//! files whose lock can be taken belong to an instance that's gone, and can be
//! recovered; the files of other running instances are left alone.

use serde::{Deserialize, Serialize};
use std::fs::{self, File, TryLockError};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Recovery {
    dir: PathBuf,
    session: String,
    lock: Mutex<Option<File>>,
}

/// What a recovery file belongs to
#[derive(Serialize, Deserialize, Default)]
struct Meta {
    path: Option<String>,
}

/// Unsaved work left behind by an instance that has ended
#[derive(Serialize)]
pub struct RecoveryEntry {
    id: String,
    path: Option<String>, // the label's file, if it had been saved before
    saved_at: u64,        // when the copy was last updated, in ms since the Unix epoch
}

fn unix_millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Removes a file, ignoring one that's already gone
fn remove(path: &PathBuf) -> Result<(), String> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("Failed to remove {}: {}", path.display(), e)),
        _ => Ok(()),
    }
}

impl Recovery {
    /// Starts this instance's session in `dir`. Without a lock (e.g. the folder isn't
    /// writable) recovery copies still work, but could be offered to another instance
    /// while this one runs, so none are written.
    pub fn start(dir: PathBuf) -> Self {
        let session = format!("{}-{}", unix_millis(SystemTime::now()), std::process::id());
        let lock = fs::create_dir_all(&dir)
            .ok()
            .and_then(|_| File::create(dir.join(format!("{session}.lock"))).ok())
            .filter(|file| file.try_lock().is_ok());
        Recovery { dir, session, lock: Mutex::new(lock) }
    }

    fn file(&self, id: &str, extension: &str) -> PathBuf {
        self.dir.join(format!("{id}.{extension}"))
    }

    /// Session ids are made by `start`; anything else isn't ours to touch
    fn check_id(id: &str) -> Result<(), String> {
        if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit() || c == '-') {
            Ok(())
        } else {
            Err(format!("Invalid recovery id: {}", id))
        }
    }

    fn has_lock(&self) -> bool {
        self.lock.lock().map(|lock| lock.is_some()).unwrap_or(false)
    }

    /// Whether session `id` has ended, so its files can be recovered or removed
    fn has_ended(&self, id: &str) -> bool {
        if id == self.session {
            return false;
        }
        match File::open(self.file(id, "lock")) {
            Err(_) => true, // no lock file: nothing is holding it
            Ok(file) => match file.try_lock() {
                Ok(()) => true, // released again when `file` is dropped
                Err(TryLockError::WouldBlock) => false,
                Err(TryLockError::Error(_)) => false, // can't tell: leave it alone
            },
        }
    }

    /// Keeps a copy of this session's unsaved label
    pub fn write(&self, contents: &str, path: Option<String>) -> Result<(), String> {
        if !self.has_lock() {
            return Ok(());
        }
        let meta = serde_json::to_string(&Meta { path }).map_err(|e| e.to_string())?;
        crate::write_atomically(&self.file(&self.session, "labelgood"), contents)?;
        crate::write_atomically(&self.file(&self.session, "json"), &meta)
    }

    /// Removes this session's copy: its changes were saved or deliberately discarded
    pub fn clear(&self) -> Result<(), String> {
        remove(&self.file(&self.session, "labelgood"))?;
        remove(&self.file(&self.session, "json"))
    }

    /// Unsaved work from instances that have ended, most recent first. Also tidies up
    /// lock files that ended sessions left without anything to recover.
    pub fn list(&self) -> Vec<RecoveryEntry> {
        let Ok(dir) = fs::read_dir(&self.dir) else { return Vec::new() };
        let mut entries = Vec::new();
        for entry in dir.flatten() {
            let path = entry.path();
            // A write cut short (e.g. `<id>.labelgood.tmp`) leaves a temporary file behind
            if path.extension().is_some_and(|ext| ext == "tmp") {
                let id = path.file_name().and_then(|name| name.to_str()).and_then(|name| name.split('.').next());
                if id.is_some_and(|id| Self::check_id(id).is_ok() && self.has_ended(id)) {
                    let _ = remove(&path);
                }
                continue;
            }
            let (Some(id), Some(extension)) = (
                path.file_stem().and_then(|s| s.to_str()).map(str::to_string),
                path.extension().and_then(|s| s.to_str()),
            ) else {
                continue;
            };
            if Self::check_id(&id).is_err() || !self.has_ended(&id) {
                continue;
            }
            match extension {
                "labelgood" => {
                    let meta: Meta = fs::read_to_string(self.file(&id, "json"))
                        .ok()
                        .and_then(|json| serde_json::from_str(&json).ok())
                        .unwrap_or_default();
                    let saved_at = entry.metadata().and_then(|m| m.modified()).map(unix_millis).unwrap_or(0);
                    entries.push(RecoveryEntry { id, path: meta.path, saved_at });
                }
                "lock" if !self.file(&id, "labelgood").exists() => {
                    let _ = remove(&self.file(&id, "json"));
                    let _ = remove(&path);
                }
                _ => {}
            }
        }
        entries.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
        entries
    }

    pub fn read(&self, id: &str) -> Result<String, String> {
        Self::check_id(id)?;
        fs::read_to_string(self.file(id, "labelgood")).map_err(|e| format!("Failed to read the recovered label: {}", e))
    }

    /// Removes an ended session's files (after restoring it, or to throw it away)
    pub fn discard(&self, id: &str) -> Result<(), String> {
        Self::check_id(id)?;
        if !self.has_ended(id) {
            return Err("That label is still open in another Labelgood window.".to_string());
        }
        remove(&self.file(id, "labelgood"))?;
        remove(&self.file(id, "json"))?;
        remove(&self.file(id, "lock"))
    }

    pub fn discard_all(&self) -> Result<(), String> {
        self.list().iter().try_for_each(|entry| self.discard(&entry.id))
    }

    /// Ends this session on a normal exit. Its copy is kept if there still is one.
    pub fn end(&self) {
        if let Ok(mut lock) = self.lock.lock() {
            if lock.take().is_some() {
                let _ = remove(&self.file(&self.session, "lock"));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_ended_sessions_are_offered() {
        let dir = tempfile::tempdir().unwrap();
        let first = Recovery::start(dir.path().to_path_buf());
        // Session ids include the start time in ms; keep the two apart
        std::thread::sleep(std::time::Duration::from_millis(5));
        let second = Recovery::start(dir.path().to_path_buf());

        first.write("{}", Some("label.labelgood".to_string())).unwrap();
        // The first session still runs (holds its lock): nothing to offer
        assert!(second.list().is_empty());
        assert!(second.discard(&first.session).is_err());

        // Ended without clearing its copy, as after a crash
        first.end();
        let entries = second.list();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path.as_deref(), Some("label.labelgood"));
        assert_eq!(second.read(&entries[0].id).unwrap(), "{}");

        second.discard(&entries[0].id).unwrap();
        assert!(second.list().is_empty());
    }

    #[test]
    fn cleared_copies_leave_nothing_behind() {
        let dir = tempfile::tempdir().unwrap();
        let first = Recovery::start(dir.path().to_path_buf());
        first.write("{}", None).unwrap();
        first.clear().unwrap();
        first.end();
        let second = Recovery::start(dir.path().to_path_buf());
        assert!(second.list().is_empty());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1); // just the second session's lock
    }

    #[test]
    fn rejects_ids_that_are_not_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let recovery = Recovery::start(dir.path().to_path_buf());
        assert!(recovery.read("../secrets").is_err());
        assert!(recovery.discard("").is_err());
    }
}
