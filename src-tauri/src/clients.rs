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
    /// The server that client is in, read from the same log line.
    pub job_id: Option<String>,
}

/// pid → account id. Set at launch time, or by recognising a client that was
/// already open when the app started (see `adopt`).
static BOUND: LazyLock<Mutex<HashMap<u32, String>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// The pids this app actually opened. Only these get auto-rejoined: a client
/// the user started from Roblox itself is labelled, never resurrected.
static LAUNCHED: LazyLock<Mutex<HashSet<u32>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

/// Where pid → account bindings are remembered between runs, and the process
/// start times that make a pid safe to trust again.
///
/// A pid on its own is worthless after a restart: Windows reuses them. Pairing
/// it with the process start time is what makes it safe to say "this window is
/// still that account" when the app is reopened.
static BINDINGS: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn set_bindings_path(path: PathBuf) {
    *BINDINGS.lock().unwrap_or_else(|e| e.into_inner()) = Some(path);
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Binding {
    pid: u32,
    started: i64,
    account: String,
}

fn save_bindings() {
    let path = BINDINGS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    let Some(path) = path else {
        return;
    };
    let bound = BOUND.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let list: Vec<Binding> = bound
        .into_iter()
        .filter_map(|(pid, account)| {
            Some(Binding {
                pid,
                started: started_at(pid)?,
                account,
            })
        })
        .collect();
    if let Ok(json) = serde_json::to_vec_pretty(&list) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(path, json);
    }
}

/// Reclaims the windows this app opened last time, for the ones still running.
pub fn restore_bindings() {
    let Some(path) = BINDINGS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
    else {
        return;
    };
    let Ok(text) = std::fs::read_to_string(path) else {
        return;
    };
    let Ok(list) = serde_json::from_str::<Vec<Binding>>(&text) else {
        return;
    };

    let mut restored = 0;
    for entry in list {
        // Same pid and same start time: it is genuinely the same process.
        if started_at(entry.pid) != Some(entry.started) {
            continue;
        }
        if let Ok(mut bound) = BOUND.lock() {
            bound.insert(entry.pid, entry.account);
        }
        if let Ok(mut launched) = LAUNCHED.lock() {
            launched.insert(entry.pid);
        }
        restored += 1;
    }
    if restored > 0 {
        log::info!("client: reclaimed {restored} window(s) from the last run");
    }
}

pub fn is_launched(pid: u32) -> bool {
    LAUNCHED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .contains(&pid)
}

/// Every visible Roblox client window, largest window per process.
///
/// Each window's game is read from that window's own log, so a client opened
/// before this app started still knows what it is playing.
pub fn list() -> Vec<ClientWindow> {
    let windows = windows();
    let alive: HashSet<u32> = windows.iter().map(|w| w.pid).collect();
    let bound = {
        let mut bound = BOUND.lock().unwrap_or_else(|e| e.into_inner());
        bound.retain(|pid, _| alive.contains(&pid));
        bound.clone()
    };
    LAUNCHED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|pid| alive.contains(pid));
    // Windows reuses pids: a cached log for a dead window would label the next
    // client on that pid with someone else's game.
    LOG_OF
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .retain(|pid, _| alive.contains(pid));

    windows
        .into_iter()
        .map(|w| {
            let facts = resolve(w.pid);
            ClientWindow {
            pid: w.pid,
            hwnd: w.hwnd as i64,
            width: w.width,
            height: w.height,
            minimized: w.minimized,
            account_id: bound.get(&w.pid).cloned(),
            place_id: facts.place,
            job_id: facts.job,
        }
        })
        .collect()
}

/// Binds windows that were already open to their accounts, by reading which
/// account each client is signed into from its own log.
///
/// Without this a client started before the app (or in a previous session) shows
/// as an unlinked window with no game, because nothing ever told us whose it is.
/// `by_username` is the vault's accounts, keyed by lowercase username.
pub fn adopt(by_username: &HashMap<String, String>) {
    if by_username.is_empty() {
        return;
    }

    for w in windows() {
        if BOUND
            .lock()
            .map(|bound| bound.contains_key(&w.pid))
            .unwrap_or(true)
        {
            continue;
        }
        let Some(username) = resolve(w.pid).username else {
            continue;
        };
        let Some(id) = by_username.get(&username) else {
            continue;
        };            if let Ok(mut bound) = BOUND.lock() {
            bound.insert(w.pid, id.clone());
        }
        save_bindings();
        log::info!("client: matched an open window to a saved account");
    }
}

// ---- Which game each client is in ---------------------------------------

#[derive(Clone, Default)]
pub struct Tail {
    /// The account the client is signed into, lowercase.
    pub username: Option<String>,
    /// The last place it joined. None while it is still in the menu.
    pub place: Option<u64>,
    /// The server (job id) it joined with that place. Roblox writes it on the
    /// same line, so a client that switched servers by hand is still tracked.
    pub job: Option<String>,
}

struct Parsed {
    len: u64,
    at: SystemTime,
    value: Tail,
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
                let value = read_tail(&path, len).unwrap_or_default();
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
        if let (Some(username), Some(place)) = (parsed.username, parsed.place) {
            // Newest log first, so the freshest client per account wins.
            out.entry(username).or_insert(place);
        }
    }
    if cache.len() > 48 {
        cache.retain(|path, _| path.exists());
    }
    out
}

/// Reads only the end of a log. The interesting lines are always last, and
/// these files reach tens of megabytes.
fn read_tail(path: &Path, len: u64) -> Option<Tail> {
    use std::io::{Read, Seek, SeekFrom};

    const TAIL: u64 = 256 * 1024;
    let mut file = std::fs::File::open(path).ok()?;
    let start = len.saturating_sub(TAIL);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.take(len - start).read_to_end(&mut bytes).ok()?;
    Some(parse_tail(&String::from_utf8_lossy(&bytes)))
}

fn parse_tail(text: &str) -> Tail {
    let username = ["UserName\"%3a\"", "UserName\":\""]
        .iter()
        .find_map(|needle| {
            let at = text.rfind(needle)?;
            let rest = &text[at + needle.len()..];
            let name = rest.split('"').next().unwrap_or("");
            (!name.is_empty() && name.len() < 32).then(|| name.to_lowercase())
        });

    let mut place = None;
    let mut job = None;
    if let Some(at) = text.rfind("Joining game '") {
        let rest = &text[at + "Joining game '".len()..];
        if let Some(cut) = rest.find(" place ") {
            // The job id is whatever sits between the quotes. Roblox writes a
            // GUID; a teleport in progress can carry an empty one, so anything
            // that isn't shaped like a GUID is dropped rather than stored.
            // The slice still carries the closing quote, so trim it before the
            // shape check — a GUID with a trailing ' is not a GUID.
            let quoted = rest[..cut].trim_end_matches('\'');
            if is_job_id(quoted) {
                job = Some(quoted.to_ascii_lowercase());
            }
            place = rest[cut + 7..]
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>()
                .parse::<u64>()
                .ok();
        }
    }

    Tail {
        username,
        place,
        job,
    }
}

/// `8-4-4-4-12` hex, which is what a Roblox job id is. Kept strict: a garbled
/// line must not become a bookmark that later fails to join.
fn is_job_id(value: &str) -> bool {
    let groups: Vec<&str> = value.split('-').collect();
    groups.len() == 5
        && groups
            .iter()
            .zip([8, 4, 4, 4, 12])
            .all(|(group, want)| {
                group.len() == want && group.bytes().all(|b| b.is_ascii_hexdigit())
            })
}

/// The log a given client process is writing.
///
/// Roblox writes a client log whose name carries the session's start time in
/// UTC ("..._20261101T192922Z_Player_ECD0C_last.log"), so a window is paired to
/// its log by comparing that stamp with when the process started. A client
/// opened hours before the app still lands on the right file.
static LOG_OF: LazyLock<Mutex<HashMap<u32, Option<PathBuf>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn logs_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(|root| PathBuf::from(root).join("Roblox").join("logs"))
}

/// `20261101T192922Z` → seconds since the Unix epoch, UTC.
fn stamp_of(name: &str) -> Option<i64> {
    let at = name.find("_Player_")?;
    let head = &name[..at];
    let start = head.rfind('_')? + 1;
    let stamp = &head[start..];
    let parsed = chrono::NaiveDateTime::parse_from_str(stamp, "%Y%m%dT%H%M%SZ").ok()?;
    Some(parsed.and_utc().timestamp())
}

fn log_for(pid: u32) -> Option<PathBuf> {
    if let Some(cached) = LOG_OF
        .lock()
        .ok()
        .and_then(|cache| cache.get(&pid).cloned())
    {
        return cached;
    }

    let found = (|| {
        let started = started_at(pid)?;
        let dir = logs_dir()?;
        let mut best: Option<(i64, PathBuf)> = None;
        for entry in std::fs::read_dir(dir).ok()?.flatten() {
            let path = entry.path();
            let name = path.file_name()?.to_string_lossy().to_string();
            if !name.contains("_Player_") || !name.ends_with(".log") || name.contains("CrashHandler") {
                continue;
            }
            let Some(stamp) = stamp_of(&name) else {
                continue;
            };
            let delta = (stamp - started).abs();
            // A client's log is created as it starts; allow for a slow disk.
            if delta > 90 {
                continue;
            }
            if best.as_ref().is_none_or(|(seen, _)| delta < *seen) {
                best = Some((delta, path));
            }
        }
        best.map(|(_, path)| path)
    })();

    if let Ok(mut cache) = LOG_OF.lock() {
        if cache.len() > 64 {
            cache.clear();
        }
        cache.insert(pid, found.clone());
    }
    found
}

/// What a given client is signed into and playing, from its own log.
///
/// Re-read only when the file has grown, so this is cheap enough to call for
/// every window on every poll.
pub fn resolve(pid: u32) -> Tail {
    let Some(path) = log_for(pid) else {
        return Tail::default();
    };
    let Ok(meta) = std::fs::metadata(&path) else {
        return Tail::default();
    };
    let (len, modified) = (meta.len(), meta.modified().ok());

    let mut cache = LOGS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(entry) = cache.get(&path) {
        if entry.len == len && Some(entry.at) == modified {
            return entry.value.clone();
        }
    }
    let value = read_tail(&path, len).unwrap_or_default();
    cache.insert(
        path,
        Parsed {
            len,
            at: modified.unwrap_or(SystemTime::UNIX_EPOCH),
            value: value.clone(),
        },
    );
    value
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
                if let Ok(mut launched) = LAUNCHED.lock() {
                    launched.insert(window.pid);
                }
                save_bindings();
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

/// Shuts a client down so a fresh one can take its place.
///
/// `WM_CLOSE` first, the same way the X on the window works, so the client
/// exits in its own time and flushes what it is writing. A client that ignores
/// it — one sitting behind a modal, or one that is genuinely wedged — is
/// terminated on the pid that owned the window, after the pid is checked
/// against the window again: handles are recycled, and the last thing this
/// should ever do is kill a window that changed hands since the list was read.
///
/// Returns whether the client is gone when this comes back.
pub fn close(pid: u32, hwnd: i64) -> bool {
    #[cfg(windows)]
    {
        win::close(pid, hwnd as win::Handle)
    }
    #[cfg(not(windows))]
    {
        let _ = (pid, hwnd);
        false
    }
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

/// When a client process started, in seconds since the Unix epoch.
#[cfg(windows)]
fn started_at(pid: u32) -> Option<i64> {
    win::started_at(pid)
}

#[cfg(not(windows))]
fn started_at(_pid: u32) -> Option<i64> {
    None
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
        fn IsWindow(window: Handle) -> i32;
        fn IsWindowVisible(window: Handle) -> i32;
        fn IsIconic(window: Handle) -> i32;
        fn GetWindowThreadProcessId(window: Handle, pid: *mut u32) -> u32;
        fn GetWindowRect(window: Handle, rect: *mut Rect) -> i32;
        pub fn ShowWindow(window: Handle, command: i32) -> i32;
        pub fn SetForegroundWindow(window: Handle) -> i32;
        fn GetProcessTimes(
            process: Handle,
            created: *mut u64,
            exited: *mut u64,
            kernel: *mut u64,
            user: *mut u64,
        ) -> i32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> Handle;
        fn TerminateProcess(process: Handle, code: u32) -> i32;
        fn PostMessageW(window: Handle, message: u32, wparam: usize, lparam: isize) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
        fn QueryFullProcessImageNameW(
            process: Handle,
            flags: u32,
            buffer: *mut u16,
            size: *mut u32,
        ) -> i32;
    }

    const QUERY_LIMITED: u32 = 0x1000;
    const PROCESS_TERMINATE: u32 = 0x0001;
    const WM_CLOSE: u32 = 0x0010;
    /// Seconds between 1601-01-01 (FILETIME epoch) and 1970-01-01.
    const FILETIME_UNIX_OFFSET: i64 = 11_644_473_600;

    /// Graceful request, then a bounded wait, then force. 2s is enough for a
    /// client that is listening: it has no game state worth saving at this
    /// point, so it closes as soon as the message arrives.
    pub fn close(pid: u32, window: Handle) -> bool {
        unsafe {
            let mut owner = 0u32;
            GetWindowThreadProcessId(window, &mut owner);
            if owner != pid {
                log::warn!("client: not closing a window that is no longer that client");
                return false;
            }

            PostMessageW(window, WM_CLOSE, 0, 0);
            for _ in 0..8 {
                std::thread::sleep(std::time::Duration::from_millis(250));
                if IsWindow(window) == 0 {
                    return true;
                }
            }

            let process = OpenProcess(PROCESS_TERMINATE, 0, pid);
            if process.is_null() {
                return IsWindow(window) == 0;
            }
            let ok = TerminateProcess(process, 1) != 0;
            CloseHandle(process);
            log::warn!("client: terminated a client that would not close");
            ok
        }
    }

    pub fn started_at(pid: u32) -> Option<i64> {
        unsafe {
            let process = OpenProcess(QUERY_LIMITED, 0, pid);
            if process.is_null() {
                return None;
            }
            let mut created = 0u64;
            let mut exited = 0u64;
            let mut kernel = 0u64;
            let mut user = 0u64;
            let ok = GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user) != 0;
            CloseHandle(process);
            if !ok || created == 0 {
                return None;
            }
            Some((created / 10_000_000) as i64 - FILETIME_UNIX_OFFSET)
        }
    }

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
