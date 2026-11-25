//! Passwords, key passphrases and sudo passwords live in the OS keychain:
//! Windows Credential Manager, macOS Keychain, or the Secret Service (GNOME Keyring / KWallet) on Linux.
//! If no keychain is reachable (e.g. a bare Linux session without a Secret Service), a private file in the
//! app data folder is used instead.

use std::collections::HashMap;
use std::path::PathBuf;

const SERVICE: &str = "Rackbook";

fn entry(key: &str) -> Option<keyring::Entry> {
    keyring::Entry::new(SERVICE, key).ok()
}

pub fn set(key: &str, value: &str) -> Result<(), String> {
    match entry(key).map(|e| e.set_password(value)) {
        Some(Ok(())) => {
            file_remove(key);
            Ok(())
        }
        _ => file_set(key, value),
    }
}

pub fn get(key: &str) -> Option<String> {
    entry(key).and_then(|e| e.get_password().ok()).or_else(|| file_load().get(key).cloned())
}

pub fn delete(key: &str) {
    if let Some(e) = entry(key) {
        let _ = e.delete_credential();
    }
    file_remove(key);
}

// ---------- fallback file ----------
fn path() -> PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Rackbook").join("secrets.json")
}
fn file_load() -> HashMap<String, String> {
    std::fs::read(path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}
fn file_save(m: &HashMap<String, String>) -> Result<(), String> {
    let p = path();
    if let Some(d) = p.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    std::fs::write(&p, serde_json::to_vec(m).unwrap_or_default()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}
fn file_set(key: &str, value: &str) -> Result<(), String> {
    let mut m = file_load();
    m.insert(key.into(), value.into());
    file_save(&m)
}
fn file_remove(key: &str) {
    let mut m = file_load();
    if m.remove(key).is_some() {
        let _ = file_save(&m);
    }
}
