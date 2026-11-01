//! Anti-AFK.
//!
//! Roblox drops a client that receives no input for roughly twenty minutes.
//! This posts a harmless Tab keypress to every running client window on a timer
//! so each one keeps looking alive.
//!
//! It works on window messages: nothing is injected into the game, no process is
//! patched, and the keypress goes to that client's own window only. Tab is used
//! rather than Space because Space is a movement input — a stray Space on a
//! client you are playing would make your character jump, while Tab only opens
//! the player list.
//!
//! Off by default. Some experiences ignore synthetic input entirely, so this is
//! a convenience, not a guarantee.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// Twenty minutes is the idle window; two minutes leaves plenty of headroom and
/// keeps the pokes rare enough to be unnoticeable.
const INTERVAL: Duration = Duration::from_secs(120);

static RUNNING: AtomicBool = AtomicBool::new(false);

/// Posts one Tab press to every visible Roblox client window. Returns how many
/// windows were poked.
#[cfg(windows)]
fn poke() -> usize {
    use std::ffi::c_void;

    unsafe extern "system" {
        fn EnumWindows(callback: Option<unsafe extern "system" fn(*mut c_void, isize) -> i32>, param: isize) -> i32;
        fn IsWindowVisible(window: *mut c_void) -> i32;
        fn GetWindowThreadProcessId(window: *mut c_void, pid: *mut u32) -> u32;
        fn PostMessageW(window: *mut c_void, message: u32, wparam: usize, lparam: isize) -> i32;
        fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut c_void;
        fn CloseHandle(handle: *mut c_void) -> i32;
        fn QueryFullProcessImageNameW(
            process: *mut c_void,
            flags: u32,
            buffer: *mut u16,
            size: *mut u32,
        ) -> i32;
    }

    const WM_KEYDOWN: u32 = 0x0100;
    const WM_KEYUP: u32 = 0x0101;
    const VK_TAB: usize = 0x09;
    const QUERY_LIMITED: u32 = 0x1000;

    unsafe extern "system" fn collect(window: *mut c_void, param: isize) -> i32 {
        let windows = &mut *(param as *mut Vec<*mut c_void>);
        if IsWindowVisible(window) == 0 {
            return 1;
        }

        let mut pid = 0u32;
        GetWindowThreadProcessId(window, &mut pid);
        if pid == 0 {
            return 1;
        }

        let process = OpenProcess(QUERY_LIMITED, 0, pid);
        if process.is_null() {
            return 1;
        }

        let mut buffer = [0u16; 260];
        let mut size = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size) != 0;
        CloseHandle(process);
        if !ok {
            return 1;
        }

        let name: String = String::from_utf16_lossy(&buffer[..size as usize]);
        if name.to_ascii_lowercase().ends_with("robloxplayerbeta.exe") {
            windows.push(window);
        }
        1
    }

    let mut windows: Vec<*mut c_void> = Vec::new();
    let param = &mut windows as *mut Vec<*mut c_void> as isize;

    unsafe {
        EnumWindows(Some(collect), param);
        for window in &windows {
            // lParam 0xC0000001 is the usual "key released after being down"
            // marker; Roblox ignores the field, but some games check it.
            PostMessageW(*window, WM_KEYDOWN, VK_TAB, 1);
            PostMessageW(*window, WM_KEYUP, VK_TAB, 0xC0000001u32 as isize);
        }
    }

    windows.len()
}

#[cfg(not(windows))]
fn poke() -> usize {
    0
}

/// Starts the loop. Safe to call twice.
pub fn start() {
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    std::thread::spawn(|| {
        log::info!("anti-afk: poking clients every {}s", INTERVAL.as_secs());
        while RUNNING.load(Ordering::SeqCst) {
            let mut waited = Duration::ZERO;
            while waited < INTERVAL {
                if !RUNNING.load(Ordering::SeqCst) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(500));
                waited += Duration::from_millis(500);
            }

            let poked = poke();
            if poked > 0 {
                log::info!("anti-afk: poked {poked} client(s)");
            }
        }
    });
}

/// Stops the loop; the current wait ends within half a second.
pub fn stop() {
    if RUNNING.swap(false, Ordering::SeqCst) {
        log::info!("anti-afk: stopped");
    }
}

pub fn is_running() -> bool {
    RUNNING.load(Ordering::SeqCst)
}
