//! Running Roblox clients.
//!
//! Two jobs: list which clients are open, and remember which account each
//! window belongs to so the Clients view can label it with the right account
//! and the game it is actually in.
//!
//! The account link is claimed at launch time: before a client is opened the
//! current Roblox PIDs are snapshotted, and the next new one is bound to the
//! account that asked for it. Windows that were already open (or that Roblox
//! started itself) stay unbound rather than being guessed at — a wrong label on
//! a client is worse than no label.
//!
//! Nothing here reads the screen. The game a client is in comes from Roblox's
//! own log file, not from a capture.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

#[derive(Clone, Debug, serde::Serialize)]
pub struct ClientWindow {
    pub pid: u32,
    pub hwnd: i64,
    pub width: u32,
    pub height: u32,
    pub minimized: bool,
    pub account_id: Option<String>,
    /// The place this client is in right now, once it has joined one.
    pub place_id: Option<u64>,
}

/// pid → account id, for clients this app launched.
static BOUND: LazyLock<Mutex<HashMap<u32, String>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Every visible Roblox client window, largest window per process.
pub fn list() -> Vec<ClientWindow> {
    let windows = windows();
    let alive: HashSet<u32> = windows.iter().map(|w| w.pid).collect();
    let mut bound = BOUND.lock().unwrap_or_else(|e| e.into_inner());
    bound.retain(|pid, _| alive.contains(pid));

    windows
        .into_iter()
        .map(|w| ClientWindow {
            pid: w.pid,
            hwnd: w.hwnd as i64,
            width: w.width,
            height: w.height,
            minimized: w.minimized,
            account_id: bound.get(&w.pid).cloned(),
            place_id: None,
        })
        .collect()
}

// ---- Which game each client is in ---------------------------------------

struct Parsed {
    len: u64,
    at: SystemTime,
    value: Option<(String, u64)>,
}

/// Parsed log files, keyed by path. A client appends to its log constantly, so
/// a file is only re-read when its size or timestamp actually moved.
static LOGS: LazyLock<Mutex<HashMap<PathBuf, Parsed>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// account name (lowercase) → the place that client is in.
///
/// Roblox writes one log per client. Two lines matter: the analytics line that
/// carries `UserName", and the last `Joining game '…' place <id>` line, which
/// changes on every teleport. Only the tail is read — the files reach tens of
/// megabytes and the interesting lines are always at the end.
pub fn places() -> HashMap<String, u64> {
    let Some(dir) = std::env::var_os("LOCALAPPDATA")
        .map(|root| PathBuf::from(root).join("Roblox").join("logs"))
    else {
        return HashMap::new();
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return HashMap::new();
    };

    let mut files: Vec<(SystemTime, PathBuf, u64)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy().to_string();
            if !name.contains("_Player_") || !name.ends_with(".log") || name.contains("CrashHandler") {
                return None;
            }
            let meta = entry.metadata().ok()?;
            Some((meta.modified().ok()?, path, meta.len()))
        })
        .collect();
    files.sort_by(|a, b| b.0.cmp(&a.0));
    files.truncate(12);

    let mut out = HashMap::new();
    let mut cache = LOGS.lock().unwrap_or_else(|e| e.into_inner());
    for (modified, path, len) in files {
        let parsed = match cache.get(&path) {
            Some(entry) if entry.len == len && entry.at == modified => entry.value.clone(),
            _ => {
                let value = parse_log(&path, len);
                cache.insert(
                    path.clone(),
                    Parsed {
                        len,
                        at: modified,
                        value: value.clone(),
                    },
                );
                value
            }
        };
        if let Some((username, place)) = parsed {
            // Newest log first, so the freshest client per account wins.
            out.entry(username).or_insert(place);
        }
    }
    if cache.len() > 48 {
        cache.retain(|path, _| path.exists());
    }
    out
}

fn parse_log(path: &Path, len: u64) -> Option<(String, u64)> {
    use std::io::{Read, Seek, SeekFrom};

    const TAIL: u64 = 256 * 1024;
    let mut file = std::fs::File::open(path).ok()?;
    let start = len.saturating_sub(TAIL);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(len - start).read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);

    let username = ["UserName\"%3a\"", "UserName\":\""]
        .iter()
        .find_map(|needle| {
            let at = text.rfind(needle)?;
            let rest = &text[at + needle.len()..];
            let name = rest.split('"').next().unwrap_or("");
            (!name.is_empty() && name.len() < 32).then(|| name.to_lowercase())
        })?;

    let place = text.rfind("Joining game '").and_then(|at| {
        let rest = &text[at..];
        let cut = rest.find(" place ")?;
        rest[cut + 7..]
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse::<u64>()
            .ok()
    })?;

    Some((username, place))
}

/// Watches for the client this launch is about to start and binds it. Runs for
/// 45 seconds in the background, because a client takes a few seconds to appear
/// and a slow machine takes longer.
pub fn watch(account_id: &str) {
    let before: HashSet<u32> = windows().iter().map(|w| w.pid).collect();
    let id = account_id.to_string();

    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(45);
        while Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(700));
            for window in windows() {
                if before.contains(&window.pid) {
                    continue;
                }
                if let Ok(mut bound) = BOUND.lock() {
                    // One account, one window: a relaunch replaces the old row.
                    bound.retain(|_, owner| owner != &id);
                    bound.insert(window.pid, id.clone());
                }
                log::info!("client: bound pid {} to an account", window.pid);
                return;
            }
        }
    });
}

/// Brings a client to the front, restoring it if it was minimised.
pub fn focus(hwnd: i64) {
    #[cfg(windows)]
    unsafe {
        win::ShowWindow(hwnd as win::Handle, 9);
        win::SetForegroundWindow(hwnd as win::Handle);
    }
    #[cfg(not(windows))]
    let _ = hwnd;
}

#[derive(Clone, Copy)]
struct Raw {
    pid: u32,
    hwnd: *mut std::ffi::c_void,
    width: u32,
    height: u32,
    minimized: bool,
}

#[cfg(windows)]
fn windows() -> Vec<Raw> {
    unsafe { win::enumerate() }
}

#[cfg(not(windows))]
fn windows() -> Vec<Raw> {
    Vec::new()
}

#[cfg(windows)]
mod win {
    use super::Raw;
    use std::ffi::c_void;

    pub type Handle = *mut c_void;

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    unsafe extern "system" {
        fn EnumWindows(callback: Option<unsafe extern "system" fn(Handle, isize) -> i32>, param: isize) -> i32;
        fn IsWindowVisible(window: Handle) -> i32;
        fn IsIconic(window: Handle) -> i32;
        fn GetWindowThreadProcessId(window: Handle, pid: *mut u32) -> u32;
        fn GetWindowRect(window: Handle, rect: *mut Rect) -> i32;
        pub fn ShowWindow(window: Handle, command: i32) -> i32;
        pub fn SetForegroundWindow(window: Handle) -> i32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn CloseHandle(handle: Handle) -> i32;
        fn QueryFullProcessImageNameW(
            process: Handle,
            flags: u32,
            buffer: *mut u16,
            size: *mut u32,
        ) -> i32;
    }

    const QUERY_LIMITED: u32 = 0x1000;

    fn process_name(pid: u32) -> Option<String> {
        unsafe {
            let process = OpenProcess(QUERY_LIMITED, 0, pid);
            if process.is_null() {
                return None;
            }
            let mut buffer = [0u16; 260];
            let mut size = buffer.len() as u32;
            let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size) != 0;
            CloseHandle(process);
            if !ok {
                return None;
            }
            Some(String::from_utf16_lossy(&buffer[..size as usize]))
        }
    }

    unsafe extern "system" fn collect(window: Handle, param: isize) -> i32 {
        let found = unsafe { &mut *(param as *mut Vec<Raw>) };
        unsafe {
            if IsWindowVisible(window) == 0 {
                return 1;
            }

            let mut pid = 0u32;
            GetWindowThreadProcessId(window, &mut pid);
            if pid == 0 {
                return 1;
            }
            let Some(name) = process_name(pid) else {
                return 1;
            };
            if !name.to_ascii_lowercase().ends_with("robloxplayerbeta.exe") {
                return 1;
            }

            let mut rect = Rect::default();
            if GetWindowRect(window, &mut rect) == 0 {
                return 1;
            }
            let width = (rect.right - rect.left).max(0) as u32;
            let height = (rect.bottom - rect.top).max(0) as u32;
            // The client shows a small splash window before the game window
            // exists; anything this small is not the client.
            if width < 200 || height < 150 {
                return 1;
            }

            found.push(Raw {
                pid,
                hwnd: window,
                width,
                height,
                minimized: IsIconic(window) != 0,
            });
        }
        1
    }

    pub unsafe fn enumerate() -> Vec<Raw> {
        let mut found: Vec<Raw> = Vec::new();
        let param = &mut found as *mut Vec<Raw> as isize;
        unsafe {
            EnumWindows(Some(collect), param);
        }

        // A process can own a helper window as well; keep its largest.
        let mut best: Vec<Raw> = Vec::new();
        for window in found {
            match best
                .iter_mut()
                .find(|existing| existing.pid == window.pid)
            {
                Some(existing) => {
                    if window.width * window.height > existing.width * existing.height {
                        *existing = window;
                    }
                }
                None => best.push(window),
            }
        }
        best
    }
}
