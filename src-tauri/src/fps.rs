//! Frame-rate cap for launched clients.
//!
//! Roblox refuses a frame-rate flag (`Denied local configuration for:
//! DFIntTaskSchedulerTargetFps`), so the cap is not a fast flag — it is the
//! client's own Maximum Frame Rate setting in
//! `%LOCALAPPDATA%\Roblox\GlobalBasicSettings_13.xml`
//! (`<int name="FramerateCap">`). The client reads that once, a few seconds
//! after it starts, and writes the whole file back when it closes.
//!
//! The original file is copied aside before the first write so it can be put
//! back byte for byte when the cap is turned off or the app quits.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

const FILE: &str = "GlobalBasicSettings_13.xml";
const BACKUP_SUFFIX: &str = "accmgr-before";

/// What a missing file starts as; Roblox writes its own when a client closes.
const EMPTY: &str = "<roblox version=\"4\">\n\t<Item class=\"UserGameSettings\" referent=\"RBX0\">\n\t\t<Properties>\n\t\t</Properties>\n\t</Item>\n</roblox>\n";

const OPEN: &str = "<int name=\"FramerateCap\">";
const CLOSE: &str = "</int>";

fn settings_file() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|dir| PathBuf::from(dir).join("Roblox").join(FILE))
}

fn backup_file(file: &Path) -> PathBuf {
    file.with_file_name(format!("{FILE}.{BACKUP_SUFFIX}"))
}

/// `text` with the cap set, replacing the existing element or adding one.
fn set_cap(text: &str, cap: u32) -> String {
    let element = format!("{OPEN}{cap}{CLOSE}");

    if let Some(start) = text.find(OPEN) {
        if let Some(len) = text[start..].find(CLOSE) {
            return format!(
                "{}{}{}",
                &text[..start],
                element,
                &text[start + len + CLOSE.len()..]
            );
        }
    }

    // No cap yet: put it at the end of the first properties block, keeping the
    // file's own indentation.
    match text.find("</Properties>") {
        Some(at) => format!("{}\t\t{element}\n\t\t{}", &text[..at], &text[at..]),
        None => text.to_string(),
    }
}

/// Sets the cap on disk. Returns an error only when nothing could be written.
pub fn apply(cap: u32) -> Result<(), String> {
    let Some(file) = settings_file() else {
        return Err("LOCALAPPDATA is not set, so Roblox settings can't be found.".to_string());
    };
    let backup = backup_file(&file);

    let existing = std::fs::read_to_string(&file).ok();
    let text = existing.clone().unwrap_or_else(|| EMPTY.to_string());
    if !text.contains("</roblox>") {
        return Err(
            "Roblox's settings file is being written by a client right now. Try again in a moment."
                .to_string(),
        );
    }

    // Keep the very first version only: later changes of cap must not overwrite
    // the user's original with one of ours.
    if !backup.exists() {
        let saved = match &existing {
            Some(text) => {
                let mut bytes = vec![b'1'];
                bytes.extend_from_slice(text.as_bytes());
                bytes
            }
            None => vec![b'0'],
        };
        std::fs::write(&backup, saved)
            .map_err(|e| format!("Could not back up Roblox's settings: {e}"))?;
    }

    std::fs::write(&file, set_cap(&text, cap))
        .map_err(|e| format!("Could not write Roblox's settings: {e}"))?;
    log::info!("fps cap: {cap} written to {FILE}");
    Ok(())
}

/// Puts the user's original settings back, if we changed them.
pub fn restore() {
    let Some(file) = settings_file() else {
        return;
    };
    let backup = backup_file(&file);
    let Ok(saved) = std::fs::read(&backup) else {
        return;
    };

    let done = match saved.split_first() {
        Some((b'1', bytes)) => std::fs::write(&file, bytes),
        _ => match std::fs::remove_file(&file) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e),
        },
    };

    match done {
        Ok(()) => {
            let _ = std::fs::remove_file(&backup);
            log::info!("fps cap: Roblox's own settings restored");
        }
        Err(e) => log::warn!("fps cap: could not restore Roblox's settings: {e}"),
    }
}

/// Whether a cap is currently written.
pub fn is_active() -> bool {
    settings_file()
        .map(|file| backup_file(&file).exists())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::set_cap;

    const HEAD: &str = "<roblox version=\"4\">\n\t<Item class=\"UserGameSettings\">\n\t\t<Properties>\n";
    const TAIL: &str = "\t\t</Properties>\n\t</Item>\n</roblox>\n";

    #[test]
    fn replaces_an_existing_cap() {
        let file = format!("{HEAD}\t\t\t<int name=\"FramerateCap\">60</int>\n\t\t\t<int name=\"Other\">1</int>\n{TAIL}");
        let out = set_cap(&file, 30);
        assert!(out.contains("<int name=\"FramerateCap\">30</int>"));
        assert!(!out.contains(">60<"));
        assert!(out.contains("<int name=\"Other\">1</int>"));
        assert_eq!(out.matches("FramerateCap").count(), 1);
    }

    #[test]
    fn inserts_a_cap_when_the_file_has_none() {
        let file = format!("{HEAD}{TAIL}");
        let out = set_cap(&file, 144);
        assert!(out.contains("<int name=\"FramerateCap\">144</int>"));
        // Still inside Properties, and still valid-looking XML order.
        assert!(out.find("FramerateCap").unwrap() < out.find("</Properties>").unwrap());
        assert!(out.contains("</roblox>"));
    }

    #[test]
    fn leaves_a_file_without_properties_alone() {
        let file = "<roblox version=\"4\"></roblox>";
        assert_eq!(set_cap(file, 30), file);
    }
}
