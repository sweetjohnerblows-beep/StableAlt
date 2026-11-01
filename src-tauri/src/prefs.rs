//! Small persisted preferences, kept beside the vault.
//!
//! These are not secrets — just what the user chose — so they live in plain
//! JSON. The vault still holds every cookie behind the master password.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Prefs {
    /// Whether to hold Roblox's singleton lock, so several clients can run.
    pub multi_instance: bool,
    /// Whether the first-run question about multi-instance has been answered.
    pub multi_instance_asked: bool,
    /// Frame-rate cap for launched clients, in FPS. `None` leaves Roblox alone.
    pub fps_cap: Option<u32>,
    /// Quietly re-check saved sessions so a dead cookie shows up before a launch fails.
    pub monitor_sessions: bool,
    /// Poke idle clients so Roblox doesn't kick them for being away.
    pub anti_afk: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            // A second account should open a second window by default.
            multi_instance: true,
            multi_instance_asked: false,
            fps_cap: Some(60),
            monitor_sessions: true,
            anti_afk: false,
        }
    }
}

/// Missing or unreadable preferences fall back to the defaults: a corrupt small
/// file should never stop the app from opening.
pub fn load(path: &Path) -> Prefs {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(prefs: &Prefs, path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let text = serde_json::to_string_pretty(prefs)
        .map_err(|e| format!("Could not encode preferences: {e}"))?;
    std::fs::write(path, text).map_err(|e| format!("Could not save preferences: {e}"))
}
