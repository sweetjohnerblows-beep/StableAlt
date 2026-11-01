//! Multi-instance support.
//!
//! The Roblox client refuses to start a second copy because of two named kernel
//! objects it creates on startup: the mutex `ROBLOX_singletonMutex` and the
//! event `ROBLOX_singletonEvent`. When the mutex already exists, the new client
//! hands off to the running window and exits.
//!
//! Holding that mutex *ourselves* — owned, on a thread that lives as long as the
//! app — makes every client started afterwards find the object already claimed
//! and open normally, because the process it would defer to does not exist. The
//! event is created too, unsignalled, so that object is present exactly as the
//! client expects.
//!
//! Two rules make or break this, and they are why it "stops working" for people:
//!
//! * the lock must be claimed **before** any client starts — an object another
//!   process already owns cannot be taken, so close every Roblox window first;
//! * the holder must **stay alive**. Mutex ownership is thread-affine, so it is
//!   held on a dedicated thread; if that thread or the app exits, Windows
//!   destroys the object and the next client owns it again.
//!
//! Nothing is injected into the game and no Roblox process is touched: this only
//! creates and holds ordinary kernel objects.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

struct Running {
    stop: Sender<()>,
    thread: Option<JoinHandle<()>>,
    active: Arc<AtomicBool>,
}

static STATE: Mutex<Option<Running>> = Mutex::new(None);

/// Claims the lock. Fails with a readable reason when a Roblox client already
/// owns it, which is the one case the user can fix.
pub fn acquire() -> Result<(), String> {
    let mut slot = STATE
        .lock()
        .map_err(|_| "The multi-instance lock is unavailable.".to_string())?;

    if let Some(running) = slot.as_ref() {
        if running.active.load(Ordering::SeqCst) {
            return Ok(());
        }
    }
    // Clear a stale holder before starting a fresh one.
    if let Some(mut running) = slot.take() {
        let _ = running.stop.send(());
        if let Some(thread) = running.thread.take() {
            let _ = thread.join();
        }
    }

    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let active = Arc::new(AtomicBool::new(false));
    let flag = active.clone();

    let thread = std::thread::Builder::new()
        .name("RobloxSingletonHolder".to_string())
        .spawn(move || hold(ready_tx, stop_rx, flag))
        .map_err(|e| format!("Could not start the multi-instance thread: {e}"))?;

    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => {
            *slot = Some(Running {
                stop: stop_tx,
                thread: Some(thread),
                active,
            });
            Ok(())
        }
        Ok(Err(reason)) => {
            let _ = thread.join();
            Err(reason)
        }
        Err(_) => {
            let _ = stop_tx.send(());
            let _ = thread.join();
            Err("The multi-instance thread did not start in time.".to_string())
        }
    }
}

/// Releases the lock, restoring Roblox's normal one-client behaviour.
pub fn release() -> Result<(), String> {
    let mut slot = STATE
        .lock()
        .map_err(|_| "The multi-instance lock is unavailable.".to_string())?;
    if let Some(mut running) = slot.take() {
        let _ = running.stop.send(());
        if let Some(thread) = running.thread.take() {
            let _ = thread.join();
        }
        running.active.store(false, Ordering::SeqCst);
        log::info!("multi-instance: released (one client at a time again)");
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn is_active() -> bool {
    STATE
        .lock()
        .map(|slot| {
            slot.as_ref()
                .map(|r| r.active.load(Ordering::SeqCst))
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
pub fn is_active() -> bool {
    false
}

/// Makes sure the lock is still ours before a launch. Cheap and idempotent:
/// if the object was lost (app restart, antivirus) this takes it back.
pub fn ensure() -> bool {
    if is_active() {
        return true;
    }
    match acquire() {
        Ok(()) => true,
        Err(e) => {
            log::info!("multi-instance not active at launch: {e}");
            false
        }
    }
}

fn hold(ready: Sender<Result<(), String>>, stop: Receiver<()>, active: Arc<AtomicBool>) {
    #[cfg(target_os = "windows")]
    {
        match unsafe { win::take() } {
            Ok(held) => {
                active.store(true, Ordering::SeqCst);
                log::info!("multi-instance: holding ROBLOX_singletonMutex + ROBLOX_singletonEvent");
                let _ = ready.send(Ok(()));
                // Block for the lifetime of the app; ownership is thread-affine,
                // so this thread has to outlive every client launch.
                let _ = stop.recv();
                unsafe { win::close(held) };
                active.store(false, Ordering::SeqCst);
            }
            Err(reason) => {
                let _ = ready.send(Err(reason));
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = ready.send(Err(
            "Multi-instance is Windows-only — it only matters where Roblox runs.".to_string(),
        ));
        let _ = stop.recv();
    }
}

#[cfg(target_os = "windows")]
mod win {
    use std::ffi::c_void;

    type Handle = *mut c_void;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateMutexW(attrs: *mut c_void, initial_owner: i32, name: *const u16) -> Handle;
        fn CreateEventW(
            attrs: *mut c_void,
            manual_reset: i32,
            initial_state: i32,
            name: *const u16,
        ) -> Handle;
        fn WaitForSingleObject(handle: Handle, millis: u32) -> u32;
        fn CloseHandle(handle: Handle) -> i32;
    }

    const ERROR_ALREADY_EXISTS: i32 = 183;
    const WAIT_OBJECT_0: u32 = 0;
    const WAIT_ABANDONED: u32 = 0x80;

    pub struct Held {
        mutex: Handle,
        event: Handle,
    }

    fn wide(name: &str) -> Vec<u16> {
        name.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub unsafe fn take() -> Result<Held, String> {
        unsafe {
            // Session-local name on purpose: a `Global\` prefix would be a
            // different object and would do nothing at all.
            let mutex_name = wide("ROBLOX_singletonMutex");
            let mutex = CreateMutexW(std::ptr::null_mut(), 1, mutex_name.as_ptr());
            let created = std::io::Error::last_os_error()
                .raw_os_error()
                .unwrap_or_default();
            if mutex.is_null() {
                return Err(format!(
                    "Windows refused to create ROBLOX_singletonMutex (error {created})."
                ));
            }

            // Someone else may already hold it. A zero-timeout wait tells us
            // whether ownership is available; an abandoned object (the previous
            // owner died) still counts as ours.
            let owned = if created == ERROR_ALREADY_EXISTS {
                let wait = WaitForSingleObject(mutex, 0);
                wait == WAIT_OBJECT_0 || wait == WAIT_ABANDONED
            } else {
                true
            };

            if !owned {
                CloseHandle(mutex);
                return Err("A Roblox client is already running, so the multi-instance lock belongs to it. Close every Roblox window (check Task Manager for stragglers), then turn multi-instance back on.".to_string());
            }

            // The client creates this event too. Keeping an unsignalled
            // manual-reset event alive means the object exists without ever
            // asking a client to activate another window.
            let event_name = wide("ROBLOX_singletonEvent");
            let event = CreateEventW(std::ptr::null_mut(), 1, 0, event_name.as_ptr());
            if event.is_null() {
                CloseHandle(mutex);
                return Err("Windows refused to create ROBLOX_singletonEvent.".to_string());
            }

            Ok(Held { mutex, event })
        }
    }

    pub unsafe fn close(held: Held) {
        unsafe {
            CloseHandle(held.event);
            CloseHandle(held.mutex);
        }
    }
}
