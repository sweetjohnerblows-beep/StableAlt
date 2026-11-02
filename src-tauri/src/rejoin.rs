//! Auto-rejoin.
//!
//! A client started from here is bound to its account (see `clients`). This
//! watches those bindings: once a window that was there is gone, the client
//! either crashed or was closed, and it gets opened again in the same place.
//!
//! Nothing is guessed. Only clients this app launched are tracked, the game
//! comes from that client's own log while it was running, and after three
//! failures in a row it stops instead of respawning a broken client forever.
//!
//! If the account was sent into a named server recently enough that the lobby is
//! probably still up, the relaunch goes back to that job id instead of any
//! server of the game — a crash costs the client its window, not its session.
//!
//! That pin is not trusted blindly. A lobby that is full, shut down or recycled
//! leaves the client on a failed-join screen, so a pinned relaunch that has not
//! joined anything after `JOIN_GRACE` is treated as a dead server: the bookmark
//! is dropped, the stuck window is closed, and the retry takes any server of the
//! same game instead of leaving the account stranded outside it.

use std::collections::HashMap;
use std::sync::LazyLock;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;

use crate::vault::Account;
use crate::{clients, prefs, VaultState};

struct Tracked {
    pid: u32,
    /// The last place this client was seen in, so a relaunch lands in the same
    /// game rather than the account's default.
    place: Option<u64>,
    attempts: u8,
    tried: Option<Instant>,
    /// The server a relaunch was sent into, while waiting to see it land there.
    /// Cleared on landing, and treated as a dead lobby if it never does.
    pending_job: Option<String>,
    pending_since: Option<Instant>,
}

static TRACKED: LazyLock<Mutex<HashMap<String, Tracked>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// A closed client shows up as a missing window, so this only needs to be
/// quicker than the user noticing.
const POLL: Duration = Duration::from_secs(4);
/// Long enough for a relaunched client to appear and claim its binding.
const BACKOFF: Duration = Duration::from_secs(25);
/// Three strikes, then leave it alone until the user launches it themselves.
const MAX_ATTEMPTS: u8 = 3;
/// How long a remembered job id is worth reusing. Roblox recycles servers, and a
/// dead id sends the client to a failed join instead of into a game — so a
/// bookmark older than this is dropped and the client takes any server with
/// room. Two hours covers a crash someone notices late without pretending the
/// lobby is still there hours on.
const SERVER_MEMORY_MINUTES: i64 = 120;
/// How long a client gets to land in the server it was sent back to before the
/// lobby is assumed gone. A normal join takes a few seconds; a dead or full job
/// id leaves the client sitting on a failed-join screen and never writes the
/// "Joining game" line, which is what makes the difference visible at all.
const JOIN_GRACE: Duration = Duration::from_secs(45);

pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL);
        tick(&app);
    });
}

fn tracked() -> std::sync::MutexGuard<'static, HashMap<String, Tracked>> {
    TRACKED.lock().unwrap_or_else(|e| e.into_inner())
}

fn tick(app: &tauri::AppHandle) {
    // Where every live client actually is, straight from its own log. Collected
    // before the rejoin switch is read: a server someone joined by hand is worth
    // remembering whether or not clients are being reopened automatically.
    let list = clients::list();
    sync_bookmarks(app, &list);

    let Ok(path) = crate::prefs_path(app) else {
        return;
    };
    if !prefs::load(&path).auto_rejoin {
        tracked().clear();
        return;
    }

    // A relaunch that was pinned to one server, but which never landed there,
    // is a dead or full lobby: forget that job and let the retry take any
    // server of the same game instead of leaving the client stuck.
    let stalled = {
        let mut map = tracked();
        detect_stalled_joins(&mut map, &list, Instant::now())
    };
    if !stalled.is_empty() {
        log::warn!(
            "rejoin: {} same-server relaunch(es) never landed, falling back to any server",
            stalled.len()
        );
        let ids: Vec<String> = stalled.iter().map(|stuck| stuck.id.clone()).collect();
        forget_servers(app, &ids);
        // The client is still open, sitting on a failed join, so it has to go
        // before the retry can take its place. Closing it is what turns a stuck
        // window into a closed client the next poll is allowed to reopen — with
        // no job id left to pin it, that reopen lands in any server of the game.
        for stuck in &stalled {
            if clients::close(stuck.pid, stuck.hwnd) {
                log::info!("rejoin: closed a client that could not get into its server");
            } else {
                log::warn!("rejoin: could not close the client stuck outside its server");
            }
        }
    }

    // id → (lowercase username, saved place), plus the server each account was
    // last sent into. Both are empty while the vault is locked, which is also
    // when there is nothing we could launch anyway.
    let (accounts, servers): (HashMap<String, (String, Option<u64>)>, HashMap<String, (u64, String)>) = {
        let state = app.state::<VaultState>();
        let Ok(guard) = state.0.lock() else {
            return;
        };
        match guard.as_ref() {
            Some(session) => (
                session
                    .data
                    .accounts
                    .iter()
                    .map(|a| (a.id.clone(), (a.username.to_lowercase(), a.place_id)))
                    .collect(),
                remembered_servers(&session.data.accounts),
            ),
            None => (HashMap::new(), HashMap::new()),
        }
    };
    if accounts.is_empty() {
        tracked().clear();
        return;
    }

    let alive: std::collections::HashSet<u32> = list.iter().map(|c| c.pid).collect();

    let relaunch = {
        let mut map = tracked();
        note_live(&mut map, &list, &accounts, Instant::now());
        decide(&mut map, &alive, &accounts, Instant::now())
    };

    for (id, place) in relaunch {
        // Back into the same lobby when that is still plausible, otherwise any
        // server of the same game.
        let job = job_for(&servers, &id, place);
        log::info!("rejoin: relaunching a client that closed ({})", if job.is_some() {
            "same server"
        } else {
            "any server"
        });
        // Watch for this one landing, so a lobby that is already gone can be
        // recognised instead of being retried forever.
        if let Some(job) = job.as_deref() {
            let mut map = tracked();
            if let Some(entry) = map.get_mut(&id) {
                entry.pending_job = Some(job.to_string());
                entry.pending_since = Some(Instant::now());
            }
        }

        let state = app.state::<VaultState>();
        match tauri::async_runtime::block_on(crate::launch(
            app,
            &state,
            &id,
            place,
            job.as_deref(),
        )) {
            Ok(_) => {}
            Err(e) => log::warn!("rejoin: could not relaunch: {e}"),
        }
    }
}

/// A relaunch that was pinned to one server and never got in.
struct Stalled {
    id: String,
    pid: u32,
    hwnd: i64,
}

/// Which accounts were sent back into a server and never arrived.
///
/// Landing is judged by the client's own log: it is in a game once the log names
/// a job id. A client that ends up in a *different* server counts as landed too —
/// it is playing something, and the bookmark sync will record where it actually
/// is. Pending state is cleared either way, so each relaunch is only judged once,
/// and the attempt count is reset for a stall: the lobby was the problem, not the
/// client, so the fallback retry gets a fresh three tries of its own.
fn detect_stalled_joins(
    map: &mut HashMap<String, Tracked>,
    list: &[clients::ClientWindow],
    now: Instant,
) -> Vec<Stalled> {
    let mut stalled = Vec::new();

    for client in list {
        let Some(id) = client.account_id.as_ref() else {
            continue;
        };
        let Some(entry) = map.get_mut(id) else {
            continue;
        };
        let (Some(job), Some(since)) = (entry.pending_job.clone(), entry.pending_since) else {
            continue;
        };

        if client.job_id.is_some() {
            // In a server — the one we asked for, or another one. Done either way.
            entry.pending_job = None;
            entry.pending_since = None;
            continue;
        }

        if now.saturating_duration_since(since) < JOIN_GRACE {
            continue;
        }

        // Still not in a game after the grace period: that lobby is gone.
        log::info!("rejoin: server {job} did not let the client in");
        entry.pending_job = None;
        entry.pending_since = None;
        entry.attempts = 0;
        stalled.push(Stalled {
            id: id.clone(),
            pid: client.pid,
            hwnd: client.hwnd,
        });
    }

    stalled
}

/// Drops the remembered server for these accounts, so the next relaunch takes
/// any server of the game. The place is kept: only the job is in doubt.
fn forget_servers(app: &tauri::AppHandle, ids: &[String]) {
    let Ok(path) = crate::vault_path(app) else {
        return;
    };
    let state = app.state::<VaultState>();
    let Ok(mut guard) = state.0.lock() else {
        return;
    };
    let Some(session) = guard.as_mut() else {
        return;
    };

    let mut changed = false;
    for account in session.data.accounts.iter_mut() {
        if !ids.iter().any(|id| *id == account.id) || account.last_job.is_none() {
            continue;
        }
        account.last_job = None;
        account.last_job_at = None;
        changed = true;
    }

    if changed {
        if let Err(e) = crate::vault::save(session, &path) {
            log::warn!("rejoin: could not clear a dead server: {e}");
        }
    }
}

/// Copies what each open client is really doing into its account's bookmark.
///
/// The launch path can only record a server it chose itself; this closes the
/// gap when someone switches servers inside the game, teleports, or joins a
/// friend. Clients are matched by the account each window is bound to, not by
/// name in the log — the binding is what the rest of the app already trusts.
/// The vault is written only when a place or job actually changed.
fn sync_bookmarks(app: &tauri::AppHandle, list: &[clients::ClientWindow]) {
    let seen: Vec<(&str, u64, &str)> = list
        .iter()
        .filter_map(|client| {
            let id = client.account_id.as_deref()?;
            let place = client.place_id?;
            let job = client.job_id.as_deref().filter(|job| !job.is_empty())?;
            Some((id, place, job))
        })
        .collect();
    if seen.is_empty() {
        return;
    }

    let Ok(path) = crate::vault_path(app) else {
        return;
    };
    let state = app.state::<VaultState>();
    let Ok(mut guard) = state.0.lock() else {
        return;
    };
    let Some(session) = guard.as_mut() else {
        return;
    };

    let mut changed = false;
    for account in session.data.accounts.iter_mut() {
        let Some((_, place, job)) = seen.iter().find(|(id, _, _)| *id == account.id) else {
            continue;
        };
        if account.last_place == Some(*place) && account.last_job.as_deref() == Some(*job) {
            continue;
        }
        account.last_place = Some(*place);
        account.last_job = Some((*job).to_string());
        account.last_job_at = Some(crate::now());
        changed = true;
        log::info!("rejoin: an open client moved to another server, bookmarking it");
    }

    if changed {
        if let Err(e) = crate::vault::save(session, &path) {
            log::warn!("rejoin: could not save the server bookmark: {e}");
        }
    }
}

/// The server each account was last sent into, ignoring bookmarks too old to
/// still exist and bookmarks for a place other than the one saved on the
/// account.
fn remembered_servers(accounts: &[Account]) -> HashMap<String, (u64, String)> {
    let now = chrono::Utc::now();
    accounts
        .iter()
        .filter_map(|account| {
            let place = account.last_place?;
            let job = account.last_job.clone().filter(|job| !job.is_empty())?;
            let at = account
                .last_job_at
                .as_ref()
                .and_then(|iso| chrono::DateTime::parse_from_rfc3339(iso).ok())?;
            let age = now.signed_duration_since(at.with_timezone(&chrono::Utc));
            if age.num_minutes() > SERVER_MEMORY_MINUTES {
                return None;
            }
            Some((account.id.clone(), (place, job)))
        })
        .collect()
}

/// The job id to reuse for this account, if its bookmark is for the place we
/// are about to relaunch into.
fn job_for(
    servers: &HashMap<String, (u64, String)>,
    id: &str,
    place: Option<u64>,
) -> Option<String> {
    let place = place?;
    let (remembered_place, job) = servers.get(id)?;
    (*remembered_place == place).then(|| job.clone())
}

/// Remembers where each live client is, so its place outlives the window, and
/// resets the counter when an account comes back with a new pid.
///
/// The place comes from the client's own log — read per process by `clients` —
/// so a client that moved to another game is reopened into *that* game rather
/// than the one saved on the account.
fn note_live(
    map: &mut HashMap<String, Tracked>,
    list: &[clients::ClientWindow],
    accounts: &HashMap<String, (String, Option<u64>)>,
    now: Instant,
) {
    for client in list {
        let Some(id) = client.account_id.as_ref() else {
            continue;
        };
        // A window recognised on sight is labelled, but only a client this app
        // opened is put back after it closes.
        if !clients::is_launched(client.pid) {
            continue;
        }
        let Some((_username, saved)) = accounts.get(id) else {
            continue;
        };
        // What the window is actually in, straight from its log.
        let live_place = client.place_id;
        let entry = map.entry(id.clone()).or_insert(Tracked {
            pid: client.pid,
            place: live_place.or(*saved),
            attempts: 0,
            tried: None,
            pending_job: None,
            pending_since: None,
        });
        if entry.pid != client.pid {
            // A new window for the same account: a fresh client, not a retry.
            entry.pid = client.pid;
            entry.attempts = 0;
            entry.tried = None;
            // A pin older than the join grace never produced this window: the
            // launch it belonged to failed, or the client was opened by hand
            // long after. Judging it against this window would close a client
            // nobody asked us to touch, so the pin is dropped instead.
            if entry
                .pending_since
                .is_some_and(|since| now.saturating_duration_since(since) >= JOIN_GRACE)
            {
                entry.pending_job = None;
                entry.pending_since = None;
            }
        }
        if let Some(place) = live_place {
            entry.place = Some(place);
        }
    }
}

/// Which accounts need a client reopened, and into which place.
///
/// Split out from the polling loop so the rules can be tested without Roblox:
/// a live window is never touched, a closed one is retried at most three times
/// with a gap between attempts, and one whose account is gone is forgotten.
fn decide(
    map: &mut HashMap<String, Tracked>,
    alive: &std::collections::HashSet<u32>,
    accounts: &HashMap<String, (String, Option<u64>)>,
    now: Instant,
) -> Vec<(String, Option<u64>)> {
    let mut out = Vec::new();

    for (id, entry) in map.iter_mut() {
        // An account removed from the vault (or hidden by a lock) can't be
        // launched at all, so it isn't retried.
        if !accounts.contains_key(id) {
            continue;
        }
        if alive.contains(&entry.pid) || entry.attempts >= MAX_ATTEMPTS {
            continue;
        }
        if entry
            .tried
            .is_some_and(|at| now.saturating_duration_since(at) < BACKOFF)
        {
            continue;
        }
        entry.attempts += 1;
        entry.tried = Some(now);
        let place = entry
            .place
            .or_else(|| accounts.get(id).and_then(|(_, saved)| *saved));
        out.push((id.clone(), place));
    }

    // Forget accounts that were removed from the vault.
    map.retain(|id, _| accounts.contains_key(id));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn reuses_a_job_only_for_the_place_it_belongs_to() {
        let mut servers = HashMap::new();
        servers.insert("a".to_string(), (1818u64, "job-1".to_string()));

        assert_eq!(job_for(&servers, "a", Some(1818)), Some("job-1".to_string()));
        // Saved place changed since the bookmark: do not jump back to the old game.
        assert_eq!(job_for(&servers, "a", Some(920587237)), None);
        // Nothing known about the place at all.
        assert_eq!(job_for(&servers, "a", None), None);
        // No bookmark for this account.
        assert_eq!(job_for(&servers, "b", Some(1818)), None);
    }

    fn accounts(place: Option<u64>) -> HashMap<String, (String, Option<u64>)> {
        let mut map = HashMap::new();
        map.insert("a".to_string(), ("alt".to_string(), place));
        map
    }

    fn tracked_at(pid: u32, place: Option<u64>) -> HashMap<String, Tracked> {
        let mut map = HashMap::new();
        map.insert(
            "a".to_string(),
            Tracked {
                pid,
                place,
                attempts: 0,
                tried: None,
                pending_job: None,
                pending_since: None,
            },
        );
        map
    }

    fn window(pid: u32, job: Option<&str>) -> clients::ClientWindow {
        clients::ClientWindow {
            pid,
            hwnd: pid as i64,
            width: 800,
            height: 600,
            minimized: false,
            account_id: Some("a".to_string()),
            place_id: Some(42),
            job_id: job.map(str::to_string),
        }
    }

    /// The state left behind by `tick` when it pinned a relaunch to a server.
    fn pending(pid: u32, at: Instant) -> HashMap<String, Tracked> {
        let mut map = tracked_at(pid, Some(42));
        let entry = map.get_mut("a").unwrap();
        entry.pending_job = Some("0e1f0e9a-1111-4c4c-9c9c-222233334444".to_string());
        entry.pending_since = Some(at);
        entry.attempts = 1;
        map
    }

    #[test]
    fn a_server_that_never_lets_the_client_in_is_given_up_on() {
        let now = Instant::now();
        let mut map = pending(5, now);
        let out = detect_stalled_joins(
            &mut map,
            &[window(5, None)],
            now + JOIN_GRACE + Duration::from_secs(1),
        );

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "a");
        assert_eq!(out[0].pid, 5);
        // The window is named so the caller can close it.
        assert_eq!(out[0].hwnd, 5);
        // Pending is cleared, so this stall is only acted on once.
        assert!(map["a"].pending_job.is_none());
        // And the fallback retry is not charged against the stalled attempt.
        assert_eq!(map["a"].attempts, 0);
    }

    #[test]
    fn a_slow_join_keeps_its_grace_period() {
        let now = Instant::now();
        let mut map = pending(5, now);
        let out = detect_stalled_joins(&mut map, &[window(5, None)], now + Duration::from_secs(10));
        assert!(out.is_empty());
        assert!(map["a"].pending_job.is_some());
    }

    #[test]
    fn landing_in_any_server_counts_as_landed() {
        // The pinned lobby was gone, but the client got into some other server
        // of the same game: it is playing, and the bookmark sync records where.
        let now = Instant::now();
        let mut map = pending(5, now);
        let out = detect_stalled_joins(
            &mut map,
            &[window(5, Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"))],
            now + JOIN_GRACE * 2,
        );
        assert!(out.is_empty());
        assert!(map["a"].pending_job.is_none());
    }

    #[test]
    fn a_client_that_is_not_pending_is_never_touched() {
        let now = Instant::now();
        let mut map = tracked_at(5, Some(42));
        let out = detect_stalled_joins(&mut map, &[window(5, None)], now + JOIN_GRACE * 3);
        assert!(out.is_empty());
    }

    #[test]
    fn a_stale_pin_is_not_judged_against_a_new_window() {
        // The pinned launch failed, and a client for that account only appears a
        // minute later, opened by hand. Closing it would be the app reaching
        // into a window it never launched.
        let now = Instant::now();
        let mut map = pending(5, now);
        let later = now + JOIN_GRACE + Duration::from_secs(30);
        note_live(&mut map, &[window(9, None)], &accounts(Some(42)), later);
        assert!(map["a"].pending_job.is_none());
        assert!(detect_stalled_joins(&mut map, &[window(9, None)], later).is_empty());
    }

    #[test]
    fn a_fresh_pin_still_watches_the_window_it_launched() {
        let now = Instant::now();
        let mut map = pending(5, now);
        note_live(&mut map, &[window(9, None)], &accounts(Some(42)), now + Duration::from_secs(5));
        assert!(map["a"].pending_job.is_some());
        let out = detect_stalled_joins(&mut map, &[window(9, None)], now + JOIN_GRACE * 2);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].pid, 9);
    }

    #[test]
    fn a_live_client_is_left_alone() {
        let mut map = tracked_at(10, Some(42));
        let alive: HashSet<u32> = [10].into_iter().collect();
        assert!(decide(&mut map, &alive, &accounts(None), Instant::now()).is_empty());
        assert_eq!(map["a"].attempts, 0);
    }

    #[test]
    fn a_closed_client_rejoins_its_place() {
        let mut map = tracked_at(10, Some(42));
        let out = decide(&mut map, &HashSet::new(), &accounts(None), Instant::now());
        assert_eq!(out, vec![("a".to_string(), Some(42))]);
    }

    #[test]
    fn it_falls_back_to_the_saved_place() {
        let mut map = tracked_at(10, None);
        let out = decide(&mut map, &HashSet::new(), &accounts(Some(7)), Instant::now());
        assert_eq!(out, vec![("a".to_string(), Some(7))]);
    }

    #[test]
    fn a_client_in_another_game_is_reopened_into_that_game() {
        // The account is set to place 42, but the client it opened was in 99.
        let mut map = HashMap::new();
        let live = vec![clients::ClientWindow {
            pid: 5,
            hwnd: 0,
            width: 0,
            height: 0,
            minimized: false,
            account_id: Some("a".to_string()),
            place_id: Some(99),
            job_id: Some("34413604-9b37-4677-98a6-2937e3b338fa".to_string()),
        }];
        note_live(&mut map, &live, &accounts(Some(42)), Instant::now());

        let out = decide(&mut map, &HashSet::new(), &accounts(Some(42)), Instant::now());
        assert_eq!(out, vec![("a".to_string(), Some(99))]);
    }

    #[test]
    fn the_next_poll_waits_before_retrying() {
        let now = Instant::now();
        let mut map = tracked_at(10, Some(42));
        let accounts = accounts(None);
        assert_eq!(decide(&mut map, &HashSet::new(), &accounts, now).len(), 1);
        // Same instant: backoff, so nothing.
        assert!(decide(&mut map, &HashSet::new(), &accounts, now).is_empty());
        // Allowed again after the backoff.
        let later = now + BACKOFF + Duration::from_secs(1);
        assert_eq!(decide(&mut map, &HashSet::new(), &accounts, later).len(), 1);
    }

    #[test]
    fn it_gives_up_after_three_attempts() {
        let start = Instant::now();
        let mut map = tracked_at(10, Some(42));
        let accounts = accounts(None);
        let mut total = 0;
        for step in 0..6u64 {
            let at = start + BACKOFF * (step as u32 * 2);
            total += decide(&mut map, &HashSet::new(), &accounts, at).len();
        }
        assert_eq!(total, 3);
    }

    #[test]
    fn a_new_pid_resets_the_attempts() {
        let mut map = tracked_at(10, Some(42));
        decide(&mut map, &HashSet::new(), &accounts(None), Instant::now());
        assert_eq!(map["a"].attempts, 1);

        // The relaunched client appears and is bound to the same account.
        let live = vec![clients::ClientWindow {
            pid: 11,
            hwnd: 0,
            width: 0,
            height: 0,
            minimized: false,
            account_id: Some("a".to_string()),
            place_id: None,
            job_id: None,
        }];
        note_live(&mut map, &live, &accounts(None), Instant::now());
        assert_eq!(map["a"].pid, 11);
        assert_eq!(map["a"].attempts, 0);
    }

    #[test]
    fn a_removed_account_is_forgotten() {
        let mut map = tracked_at(10, Some(42));
        let out = decide(&mut map, &HashSet::new(), &HashMap::new(), Instant::now());
        assert!(out.is_empty());
        assert!(map.is_empty());
    }
}
