//! Low-memory mode: makes the clients this app starts use as little as Roblox
//! will give up.
//!
//! The only flags Roblox still honours are the ones on its local-configuration
//! allowlist; anything else is ignored with `Denied local configuration for: …`
//! in the client log. They live in
//! `%LOCALAPPDATA%\Roblox\Versions\version-*\ClientSettings\ClientAppSettings.json`,
//! a file every client reads once at startup and Roblox itself never writes.
//! That last part matters: because the client never rewrites it, applying and
//! restoring is race-free, unlike Roblox's own settings XML.
//!
//! The set below is the memory-relevant subset of that allowlist: lowest
//! geometry detail (the CSG LOD distances), lowest texture quality, lowest
//! render quality, no MSAA, no grass, and a flat sky. Textures and geometry are
//! where a client's memory actually goes.
//!
//! The user's own flags in that file are kept: ours are merged on top, and the
//! original file is copied beside it first so it can be put back byte for byte.
//! Note that frame-rate caps cannot be done here — Roblox denies
//! `DFIntTaskSchedulerTargetFps`; its cap lives in `GlobalBasicSettings_13.xml`.

use std::path::{Path, PathBuf};

const BACKUP_SUFFIX: &str = "accmgr-before";

/// The memory-relevant allowlisted flags, as the client parses them (strings).
const FLAGS: &[(&str, &str)] = &[
    // Lowest geometry detail: stop swapping CSG level-of-detail meshes in.
    ("DFIntCSGLevelOfDetailSwitchingDistance", "0"),
    ("DFIntCSGLevelOfDetailSwitchingDistanceL12", "0"),
    ("DFIntCSGLevelOfDetailSwitchingDistanceL23", "0"),
    ("DFIntCSGLevelOfDetailSwitchingDistanceL34", "0"),
    // Lowest texture quality — the single biggest memory saving.
    ("DFFlagTextureQualityOverrideEnabled", "True"),
    ("DFIntTextureQualityOverride", "0"),
    // Lowest render quality (the "1" of 1..21).
    ("DFIntDebugFRMQualityLevelOverride", "1"),
    // No anti-aliasing buffers.
    ("FIntDebugForceMSAASamples", "1"),
    // No grass.
    ("FIntFRMMinGrassDistance", "0"),
    ("FIntFRMMaxGrassDistance", "0"),
    // Flat sky instead of the full skybox.
    ("FFlagDebugSkyGray", "True"),
];

/// Every installed client build, newest name last. A machine usually has one,
/// but an update in progress can leave two.
fn versions() -> Vec<PathBuf> {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else {
        return Vec::new();
    };
    let root = PathBuf::from(local).join("Roblox").join("Versions");
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Vec::new();
    };

    let mut found: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|dir| dir.join("RobloxPlayerBeta.exe").is_file())
        .collect();
    found.sort();
    found
}

fn flag_file(version: &Path) -> PathBuf {
    version
        .join("ClientSettings")
        .join("ClientAppSettings.json")
}

fn backup_file(file: &Path) -> PathBuf {
    file.with_file_name(format!("ClientAppSettings.json.{BACKUP_SUFFIX}"))
}

fn apply_one(file: &Path) -> Result<(), String> {
    let backup = backup_file(file);
    // Already applied: the original is waiting to be put back.
    if backup.exists() {
        return Ok(());
    }

    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }

    let existing = std::fs::read_to_string(file).ok();
    let mut flags: serde_json::Map<String, serde_json::Value> = match existing.as_deref().map(str::trim)
    {
        None | Some("") => serde_json::Map::new(),
        Some(text) => serde_json::from_str(text).map_err(|_| {
            format!(
                "{} is not valid JSON, so it was left untouched.",
                file.display()
            )
        })?,
    };

    // `1` then the original bytes, or `0` when there was no file at all.
    let saved = match &existing {
        Some(text) => {
            let mut bytes = vec![b'1'];
            bytes.extend_from_slice(text.as_bytes());
            bytes
        }
        None => vec![b'0'],
    };
    std::fs::write(&backup, saved)
        .map_err(|e| format!("Could not back up {}: {e}", file.display()))?;

    for (key, value) in FLAGS {
        flags.insert((*key).to_string(), (*value).to_string().into());
    }

    let text = serde_json::to_string_pretty(&flags)
        .map_err(|e| format!("Could not build the flag file: {e}"))?;
    if let Err(e) = std::fs::write(file, text) {
        let _ = std::fs::remove_file(&backup);
        return Err(format!("Could not write {}: {e}", file.display()));
    }
    Ok(())
}

fn restore_one(file: &Path) {
    let backup = backup_file(file);
    let Ok(saved) = std::fs::read(&backup) else {
        return;
    };

    let done = match saved.split_first() {
        Some((b'1', bytes)) => std::fs::write(file, bytes),
        _ => match std::fs::remove_file(file) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        },
    };

    match done {
        Ok(()) => {
            let _ = std::fs::remove_file(&backup);
        }
        Err(e) => log::warn!("low memory: could not restore {}: {e}", file.display()),
    }
}

/// Applies the flags to every installed client. Returns how many were patched.
pub fn apply() -> Result<usize, String> {
    let versions = versions();
    if versions.is_empty() {
        return Err(
            "No Roblox installation found under %LOCALAPPDATA%\\Roblox\\Versions.".to_string(),
        );
    }

    let mut patched = 0;
    for version in &versions {
        if let Err(e) = apply_one(&flag_file(version)) {
            log::warn!("low memory: {e}");
        } else {
            patched += 1;
        }
    }

    if patched == 0 {
        return Err("The client's settings file could not be written.".to_string());
    }
    log::info!("low memory: flags applied to {patched} client folder(s)");
    Ok(patched)
}

/// Puts every original file back. Safe to call when nothing was applied.
pub fn restore() {
    for version in versions() {
        restore_one(&flag_file(&version));
    }
}

/// Whether our flags are currently sitting in the client folders.
pub fn is_active() -> bool {
    versions()
        .iter()
        .any(|version| backup_file(&flag_file(version)).exists())
}
