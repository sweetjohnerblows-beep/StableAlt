//! Small persisted preferences, kept beside the vault.
//!
//! These are not secrets — just what the user chose — so they live in plain
//! JSON. The vault still holds every cookie behind the master password.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// A colour scheme, stored as the seven colours a user actually picks.
///
/// Deliberately not the whole stylesheet: every other variable is derived from
/// these on the front end, so a saved theme can never leave one surface on the
/// old palette.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Theme {
    pub id: String,
    pub name: String,
    pub bg: String,
    pub panel: String,
    pub line: String,
    pub text: String,
    pub muted: String,
    pub accent: String,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            id: "ember".to_string(),
            name: "Ember".to_string(),
            bg: "#06070a".to_string(),
            panel: "#0d1015".to_string(),
            line: "#1c212a".to_string(),
            text: "#f1f3f7".to_string(),
            muted: "#6f7889".to_string(),
            accent: "#ff6a4d".to_string(),
        }
    }
}

/// Every colour must be a `#rgb`, `#rrggbb` or `#rrggbbaa` string. Anything else
/// would be written straight into a CSS variable, so it is rejected here rather
/// than trusted from the window.
pub fn is_valid(theme: &Theme) -> bool {
    fn hex(value: &str) -> bool {
        let Some(digits) = value.strip_prefix('#') else {
            return false;
        };
        matches!(digits.len(), 3 | 6 | 8) && digits.chars().all(|c| c.is_ascii_hexdigit())
    }

    hex(&theme.bg)
        && hex(&theme.panel)
        && hex(&theme.line)
        && hex(&theme.text)
        && hex(&theme.muted)
        && hex(&theme.accent)
        && !theme.id.trim().is_empty()
}

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
    /// Open a client again in the same game when it closes or crashes.
    pub auto_rejoin: bool,
    /// Closing the window hides it to the tray instead of quitting, so the
    /// background work carries on.
    pub close_to_tray: bool,
    /// The colour scheme in use.
    pub theme: Theme,
    /// Themes the user built themselves, in the order they were saved.
    pub custom_themes: Vec<Theme>,
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
            auto_rejoin: true,
            close_to_tray: true,
            theme: Theme::default(),
            custom_themes: Vec::new(),
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
