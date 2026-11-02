mod antiafk;
mod clients;
mod fps;
mod lowmem;
mod prefs;
mod rejoin;
mod roblox;
mod singleton;
mod tiling;
mod vault;

use serde::Serialize;
use std::path::PathBuf;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use std::sync::Mutex;
use tauri::Manager;
use vault::{Account, AccountView, Session};

/// The unlocked vault, if any. Nothing else holds the derived key.
pub(crate) struct VaultState(pub(crate) Mutex<Option<Session>>);

impl VaultState {
    fn new() -> Self {
        Self(Mutex::new(None))
    }
}

#[derive(Serialize)]
struct VaultStatus {
    exists: bool,
    unlocked: bool,
    path: String,
}

fn vault_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve the app data folder: {e}"))?;
    Ok(dir.join("vault.json"))
}

/// Where the windows this app opened are remembered between runs.
fn bindings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve the app data folder: {e}"))?;
    Ok(dir.join("clients.json"))
}

pub(crate) fn prefs_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(vault_path(app)?.with_file_name("prefs.json"))
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Runs blocking work (HTTP, process spawns) off the async runtime.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("Background task failed: {e}"))?
}

/// Applies fresh session data to a stored account.
fn apply_session(account: &mut Account, info: &roblox::SessionInfo, note: &str, tags: &[String]) {
    account.user_id = info.user_id;
    account.username = info.username.clone();
    account.display_name = info.display_name.clone();
    if info.avatar_url.is_some() {
        account.avatar_url = info.avatar_url.clone();
    }
    if info.robux.is_some() {
        account.robux = info.robux;
    }
    account.note = note.to_string();
    account.tags = tags.to_vec();
    account.status = "ok".to_string();
    account.checked_at = Some(now());

    // Roblox rotates `.ROBLOSECURITY` on its own schedule; whatever it hands
    // back is the value that will still work next time.
    if let Some(fresh) = &info.cookie {
        account.cookie = fresh.clone();
        log::info!("session check: stored a rotated cookie for @{}", account.username);
    }
}

fn mark_expired(account: &mut Account) {
    account.status = "expired".to_string();
    account.checked_at = Some(now());
}

#[tauri::command]
async fn vault_status(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
) -> Result<VaultStatus, String> {
    let path = vault_path(&app)?;
    let unlocked = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?
        .is_some();
    Ok(VaultStatus {
        exists: path.exists(),
        unlocked,
        path: path.display().to_string(),
    })
}

#[tauri::command]
async fn vault_create(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    password: String,
) -> Result<Vec<AccountView>, String> {
    let path = vault_path(&app)?;
    let session = vault::create(&password, &path)?;
    let accounts = session.data.accounts.iter().map(AccountView::from_account).collect();
    *state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())? = Some(session);
    Ok(accounts)
}

#[tauri::command]
async fn vault_unlock(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    password: String,
) -> Result<Vec<AccountView>, String> {
    let path = vault_path(&app)?;
    let session = vault::open(&password, &path)?;
    let accounts = session.data.accounts.iter().map(AccountView::from_account).collect();
    *state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())? = Some(session);
    Ok(accounts)
}

#[tauri::command]
async fn vault_lock(state: tauri::State<'_, VaultState>) -> Result<(), String> {
    *state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())? = None;
    Ok(())
}

/// A backup is the vault's own encrypted envelope, written wherever the user
/// picks. It is only readable with the master password that made it.
#[derive(Serialize)]
struct BackupExport {
    path: String,
    accounts: usize,
}

#[derive(Serialize)]
struct BackupImport {
    added: usize,
    skipped: usize,
    /// Set when the file needs a different master password than the one the
    /// vault is unlocked with; the window then asks for it instead of failing.
    needs_password: bool,
    accounts: Vec<AccountView>,
}

/// The picker may hand back a name with no extension, so the file still looks
/// like a backup when the user finds it again.
fn backup_dest(path: &str) -> PathBuf {
    let mut dest = PathBuf::from(path);
    if dest.extension().is_none() {
        dest.set_extension("savault");
    }
    dest
}

#[tauri::command]
async fn backup_export(
    state: tauri::State<'_, VaultState>,
    path: String,
) -> Result<BackupExport, String> {
    if path.trim().is_empty() {
        return Err("Choose where to save the backup.".to_string());
    }
    let dest = backup_dest(&path);
    let guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_ref().ok_or("Vault is locked.")?;
    if session.data.accounts.is_empty() {
        return Err("There are no accounts to back up yet.".to_string());
    }
    vault::save(session, &dest)?;
    Ok(BackupExport {
        path: dest.display().to_string(),
        accounts: session.data.accounts.len(),
    })
}

/// Folds a backup's accounts into the live list. Returns (added, skipped).
///
/// Matching is by Roblox user id, so the same account is never stored twice even
/// when it arrived from a different machine, and an account already here keeps
/// its own note, tags and launch config.
fn merge_accounts(dest: &mut Vec<Account>, incoming: Vec<Account>) -> (usize, usize) {
    let mut added = 0usize;
    let mut skipped = 0usize;
    for mut account in incoming {
        if dest.iter().any(|a| a.user_id == account.user_id) {
            skipped += 1;
            continue;
        }
        // A fresh local id: two vaults can hand out the same uuid only by
        // accident, and an id collision would break selection and launches.
        account.id = uuid::Uuid::new_v4().to_string();
        dest.push(account);
        added += 1;
    }
    (added, skipped)
}

/// Merges a backup into the vault instead of replacing it: an account already
/// here (matched by Roblox user id) keeps what it has, everything else is added
/// with its game and per-account options intact. Nothing is ever removed.
#[tauri::command]
async fn backup_import(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    path: String,
    password: Option<String>,
) -> Result<BackupImport, String> {
    let src = backup_dest(&path);
    let missing = "That backup file is not where it was.";
    let live_path = vault_path(&app)?;

    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_mut().ok_or("Vault is locked.")?;

    let restored = match password.as_deref().filter(|p| !p.is_empty()) {
        Some(pw) => vault::open_with_note(pw, &src, missing)?,
        // Saved by this device, so the key already in memory opens it without
        // making anyone type the password they just typed to unlock.
        None => match vault::open_with_key(&src, session.key(), missing) {
            Ok(restored) => restored,
            // A backup from another machine has its own salt, so this key is
            // simply the wrong one. Ask, rather than reporting a bad file.
            Err(_) => {
                return Ok(BackupImport {
                    added: 0,
                    skipped: 0,
                    needs_password: true,
                    accounts: session
                        .data
                        .accounts
                        .iter()
                        .map(AccountView::from_account)
                        .collect(),
                });
            }
        },
    };

    let (added, skipped) = merge_accounts(&mut session.data.accounts, restored.data.accounts);

    if added > 0 {
        vault::save(session, &live_path)?;
    }

    Ok(BackupImport {
        added,
        skipped,
        needs_password: false,
        accounts: session
            .data
            .accounts
            .iter()
            .map(AccountView::from_account)
            .collect(),
    })
}

#[tauri::command]
async fn accounts_list(state: tauri::State<'_, VaultState>) -> Result<Vec<AccountView>, String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_ref().ok_or("Vault is locked.")?;
    Ok(session.data.accounts.iter().map(AccountView::from_account).collect())
}

#[tauri::command]
async fn account_add(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    cookie: String,
    note: String,
    tags: Vec<String>,
) -> Result<AccountView, String> {
    let cookie = roblox::normalize_cookie(&cookie);
    if cookie.is_empty() {
        return Err("Paste a .ROBLOSECURITY cookie first.".to_string());
    }

    {
        let guard = state
            .0
            .lock()
            .map_err(|_| "Vault state is unavailable.".to_string())?;
        guard.as_ref().ok_or("Vault is locked.")?;
    }

    let probe = cookie.clone();
    let info = blocking(move || {
        let client = roblox::client()?;
        roblox::fetch_session(&client, &probe)
    })
    .await?;

    let path = vault_path(&app)?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_mut().ok_or("Vault is locked.")?;

    if let Some(existing) = session
        .data
        .accounts
        .iter()
        .find(|a| a.user_id == info.user_id)
    {
        return Err(format!(
            "@{} is already in the vault.",
            existing.username
        ));
    }

    let mut account = Account {
        id: uuid::Uuid::new_v4().to_string(),
        cookie,
        user_id: info.user_id,
        username: info.username.clone(),
        display_name: info.display_name.clone(),
        avatar_url: None,
        note: String::new(),
        tags: Vec::new(),
        robux: None,
        status: "unknown".to_string(),
        checked_at: None,
        added_at: now(),
        place_id: None,
        place_name: String::new(),
        place_icon: None,
        use_global_perf: true,
        low_graphics: true,
        fps_cap: None,
        last_place: None,
        last_job: None,
        last_job_at: None,
    };
    apply_session(&mut account, &info, &note, &tags);

    session.data.accounts.push(account.clone());
    vault::save(session, &path)?;
    Ok(AccountView::from_account(&account))
}

/// One row of a bulk import, so the UI can say what happened to each paste.
#[derive(Serialize)]
struct BulkRow {
    /// First few characters of the cookie — enough to tell rows apart, useless to anyone else.
    label: String,
    /// `added`, `duplicate` or `failed`.
    outcome: String,
    username: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
struct BulkResult {
    rows: Vec<BulkRow>,
    accounts: Vec<AccountView>,
}

fn mask(cookie: &str) -> String {
    let head: String = cookie.chars().take(12).collect();
    format!("{head}…")
}

/// Adds many cookies at once. Every cookie is checked against Roblox before it
/// is stored, so a bad paste is reported per row instead of aborting the batch.
#[tauri::command]
async fn accounts_bulk_add(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    cookies: String,
    note: String,
    tags: Vec<String>,
) -> Result<BulkResult, String> {
    // A cookie has no whitespace or commas in it, so both are safe separators —
    // which also handles pastes that arrive space- or comma-separated.
    let parsed: Vec<String> = cookies
        .split(|c: char| c.is_whitespace() || c == ',')
        .map(roblox::normalize_cookie)
        .filter(|c| !c.is_empty())
        .collect();

    if parsed.is_empty() {
        return Err("Paste at least one .ROBLOSECURITY cookie.".to_string());
    }

    let known: Vec<i64> = {
        let guard = state
            .0
            .lock()
            .map_err(|_| "Vault state is unavailable.".to_string())?;
        let session = guard.as_ref().ok_or("Vault is locked.")?;
        session.data.accounts.iter().map(|a| a.user_id).collect()
    };

    let probes = parsed.clone();
    let checks = blocking(move || {
        let client = roblox::client()?;
        let mut out = Vec::with_capacity(probes.len());
        for cookie in probes {
            let result = roblox::fetch_session(&client, &cookie);
            out.push((cookie, result));
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
        Ok(out)
    })
    .await?;

    let path = vault_path(&app)?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_mut().ok_or("Vault is locked.")?;

    let mut rows: Vec<BulkRow> = Vec::with_capacity(parsed.len());
    let mut seen: Vec<i64> = known;

    for (cookie, result) in checks {
        let label = mask(&cookie);
        match result {
            Ok(info) => {
                if seen.contains(&info.user_id) {
                    rows.push(BulkRow {
                        label,
                        outcome: "duplicate".to_string(),
                        username: Some(info.username),
                        error: None,
                    });
                    continue;
                }

                let mut account = Account {
                    id: uuid::Uuid::new_v4().to_string(),
                    cookie,
                    user_id: info.user_id,
                    username: info.username.clone(),
                    display_name: info.display_name.clone(),
                    avatar_url: None,
                    note: String::new(),
                    tags: Vec::new(),
                    robux: None,
                    status: "unknown".to_string(),
                    checked_at: None,
                    added_at: now(),
                    place_id: None,
                    place_name: String::new(),
                    place_icon: None,
                    use_global_perf: true,
                    low_graphics: true,
                    fps_cap: None,
                    last_place: None,
                    last_job: None,
                    last_job_at: None,
                };
                apply_session(&mut account, &info, &note, &tags);
                seen.push(info.user_id);

                rows.push(BulkRow {
                    label,
                    outcome: "added".to_string(),
                    username: Some(info.username),
                    error: None,
                });
                session.data.accounts.push(account);
            }
            Err(error) => rows.push(BulkRow {
                label,
                outcome: "failed".to_string(),
                username: None,
                error: Some(error),
            }),
        }

    }

    let accounts: Vec<AccountView> = session
        .data
        .accounts
        .iter()
        .map(AccountView::from_account)
        .collect();
    vault::save(session, &path)?;
    Ok(BulkResult { rows, accounts })
}

#[tauri::command]
async fn account_refresh(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    id: String,
) -> Result<AccountView, String> {
    let (cookie, note, tags) = {
        let guard = state
            .0
            .lock()
            .map_err(|_| "Vault state is unavailable.".to_string())?;
        let session = guard.as_ref().ok_or("Vault is locked.")?;
        let account = session
            .data
            .accounts
            .iter()
            .find(|a| a.id == id)
            .ok_or("That account is no longer in the vault.")?;
        (
            account.cookie.clone(),
            account.note.clone(),
            account.tags.clone(),
        )
    };

    let probe = cookie.clone();
    let result = blocking(move || {
        let client = roblox::client()?;
        roblox::fetch_session(&client, &probe)
    })
    .await;

    let path = vault_path(&app)?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_mut().ok_or("Vault is locked.")?;
    let account = session
        .data
        .accounts
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or("That account is no longer in the vault.")?;

    match result {
        Ok(info) => apply_session(account, &info, &note, &tags),
        Err(e) => {
            mark_expired(account);
            vault::save(session, &path)?;
            return Err(e);
        }
    }
    let view = AccountView::from_account(account);
    vault::save(session, &path)?;
    Ok(view)
}

/// Quiet status sweep for the session monitor: one cheap request per account,
/// no balances or avatars, and a network failure never marks anyone expired.
#[tauri::command]
async fn accounts_check_sessions(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
) -> Result<Vec<AccountView>, String> {
    let jobs: Vec<(String, String)> = {
        let guard = state
            .0
            .lock()
            .map_err(|_| "Vault state is unavailable.".to_string())?;
        let session = guard.as_ref().ok_or("Vault is locked.")?;
        session
            .data
            .accounts
            .iter()
            .map(|a| (a.id.clone(), a.cookie.clone()))
            .collect()
    };

    if jobs.is_empty() {
        return Ok(Vec::new());
    }

    let results = blocking(move || {
        let client = roblox::client()?;
        let mut out = Vec::with_capacity(jobs.len());
        for (id, cookie) in jobs {
            let verdict = roblox::check_session(&client, &cookie);
            out.push((id, verdict));
            // Roblox treats rapid bursts as abuse; one sweep is not a race.
            std::thread::sleep(std::time::Duration::from_millis(200));
        }
        Ok(out)
    })
    .await?;

    let path = vault_path(&app)?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_mut().ok_or("Vault is locked.")?;

    for (id, verdict) in results {
        if let Some(account) = session.data.accounts.iter_mut().find(|a| a.id == id) {
            match verdict {
                roblox::SessionCheck::Valid => {
                    account.status = "ok".to_string();
                    account.checked_at = Some(now());
                }
                roblox::SessionCheck::Expired => mark_expired(account),
                roblox::SessionCheck::Unknown => {}
            }
        }
    }

    let views: Vec<AccountView> = session
        .data
        .accounts
        .iter()
        .map(AccountView::from_account)
        .collect();
    vault::save(session, &path)?;
    Ok(views)
}

#[tauri::command]
async fn account_refresh_all(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
) -> Result<Vec<AccountView>, String> {
    let jobs: Vec<(String, String)> = {
        let guard = state
            .0
            .lock()
            .map_err(|_| "Vault state is unavailable.".to_string())?;
        let session = guard.as_ref().ok_or("Vault is locked.")?;
        session
            .data
            .accounts
            .iter()
            .map(|a| (a.id.clone(), a.cookie.clone()))
            .collect()
    };

    if jobs.is_empty() {
        return Ok(Vec::new());
    }

    let results = blocking(move || {
        let client = roblox::client()?;
        let mut out = Vec::with_capacity(jobs.len());
        for (id, cookie) in jobs {
            out.push((id, roblox::fetch_session(&client, &cookie)));
        }
        Ok(out)
    })
    .await?;

    let path = vault_path(&app)?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_mut().ok_or("Vault is locked.")?;

    for (id, result) in results {
        if let Some(account) = session.data.accounts.iter_mut().find(|a| a.id == id) {
            match result {
                Ok(info) => {
                    let note = account.note.clone();
                    let tags = account.tags.clone();
                    apply_session(account, &info, &note, &tags);
                }
                Err(_) => mark_expired(account),
            }
        }
    }

    let views: Vec<AccountView> = session
        .data
        .accounts
        .iter()
        .map(AccountView::from_account)
        .collect();
    vault::save(session, &path)?;
    Ok(views)
}

#[tauri::command]
async fn account_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    id: String,
    note: String,
    tags: Vec<String>,
) -> Result<AccountView, String> {
    let path = vault_path(&app)?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_mut().ok_or("Vault is locked.")?;
    let account = session
        .data
        .accounts
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or("That account is no longer in the vault.")?;
    account.note = note;
    account.tags = tags;
    let view = AccountView::from_account(account);
    vault::save(session, &path)?;
    Ok(view)
}

/// Swaps in a fresh cookie for an account that is already in the vault.
///
/// Without this the only way to fix a dead session was remove-and-re-add,
/// which also threw away the note, tags, saved game and per-account launch
/// options. The new cookie has to identify the same Roblox user, so a mis-paste
/// can never quietly repoint a row at a different account.
#[tauri::command]
async fn account_recookie(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    id: String,
    cookie: String,
) -> Result<AccountView, String> {
    let cookie = roblox::normalize_cookie(&cookie);
    if cookie.is_empty() {
        return Err("Paste a .ROBLOSECURITY cookie first.".to_string());
    }

    let (user_id, note, tags) = {
        let guard = state
            .0
            .lock()
            .map_err(|_| "Vault state is unavailable.".to_string())?;
        let session = guard.as_ref().ok_or("Vault is locked.")?;
        let account = session
            .data
            .accounts
            .iter()
            .find(|a| a.id == id)
            .ok_or("That account is no longer in the vault.")?;
        (account.user_id, account.note.clone(), account.tags.clone())
    };

    let probe = cookie.clone();
    let info = blocking(move || {
        let client = roblox::client()?;
        roblox::fetch_session(&client, &probe)
    })
    .await?;

    if info.user_id != user_id {
        return Err(format!(
            "That cookie signs in as @{}, which isn't this account. Add it as a new account instead.",
            info.username
        ));
    }

    let path = vault_path(&app)?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_mut().ok_or("Vault is locked.")?;
    let account = session
        .data
        .accounts
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or("That account is no longer in the vault.")?;

    account.cookie = cookie;
    apply_session(account, &info, &note, &tags);
    let view = AccountView::from_account(account);
    vault::save(session, &path)?;
    Ok(view)
}

#[tauri::command]
async fn account_remove(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    id: String,
) -> Result<Vec<AccountView>, String> {
    let path = vault_path(&app)?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_mut().ok_or("Vault is locked.")?;
    session.data.accounts.retain(|a| a.id != id);
    let views: Vec<AccountView> = session
        .data
        .accounts
        .iter()
        .map(AccountView::from_account)
        .collect();
    vault::save(session, &path)?;
    Ok(views)
}

/// Hands the cookie back for the clipboard. Only exists while unlocked.
#[tauri::command]
async fn account_cookie(state: tauri::State<'_, VaultState>, id: String) -> Result<String, String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_ref().ok_or("Vault is locked.")?;
    session
        .data
        .accounts
        .iter()
        .find(|a| a.id == id)
        .map(|a| a.cookie.clone())
        .ok_or_else(|| "That account is no longer in the vault.".to_string())
}

fn cookie_for(state: &tauri::State<'_, VaultState>, id: &str) -> Result<String, String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_ref().ok_or("Vault is locked.")?;
    session
        .data
        .accounts
        .iter()
        .find(|a| a.id == id)
        .map(|a| a.cookie.clone())
        .ok_or_else(|| "That account is no longer in the vault.".to_string())
}

#[tauri::command]
async fn friends_list(
    state: tauri::State<'_, VaultState>,
    id: String,
) -> Result<Vec<roblox::FriendRequest>, String> {
    let cookie = cookie_for(&state, &id)?;
    blocking(move || {
        let client = roblox::client()?;
        roblox::friend_requests(&client, &cookie)
    })
    .await
}

#[tauri::command]
async fn friend_accept(
    state: tauri::State<'_, VaultState>,
    id: String,
    user_id: i64,
) -> Result<(), String> {
    let cookie = cookie_for(&state, &id)?;
    blocking(move || {
        let client = roblox::client()?;
        roblox::accept_friend(&client, &cookie, user_id)
    })
    .await
}

#[tauri::command]
async fn friend_decline(
    state: tauri::State<'_, VaultState>,
    id: String,
    user_id: i64,
) -> Result<(), String> {
    let cookie = cookie_for(&state, &id)?;
    blocking(move || {
        let client = roblox::client()?;
        roblox::decline_friend(&client, &cookie, user_id)
    })
    .await
}

#[tauri::command]
async fn friend_send(
    state: tauri::State<'_, VaultState>,
    id: String,
    username: String,
) -> Result<String, String> {
    let cookie = cookie_for(&state, &id)?;
    blocking(move || {
        let client = roblox::client()?;
        roblox::send_friend_request(&client, &cookie, &username)
    })
    .await
}

/// Mints a launch ticket and hands the deep link to the Roblox client.
#[tauri::command]
async fn launch_account(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    id: String,
    place_id: Option<u64>,
    job_id: Option<String>,
) -> Result<String, String> {
    launch(&app, &state, &id, place_id, job_id.as_deref()).await
}

/// Opens a client for an account. Shared with auto-rejoin, so a relaunch goes
/// through exactly the same tickets, graphics flags and frame cap as a click.
pub(crate) async fn launch(
    app: &tauri::AppHandle,
    state: &VaultState,
    id: &str,
    place_id: Option<u64>,
    job_id: Option<&str>,
) -> Result<String, String> {
    let (cookie, saved_place, use_global, low_graphics, account_cap) = {
        let guard = state
            .0
            .lock()
            .map_err(|_| "Vault state is unavailable.".to_string())?;
        let session = guard.as_ref().ok_or("Vault is locked.")?;
        let account = session
            .data
            .accounts
            .iter()
            .find(|a| a.id == id)
            .ok_or("That account is no longer in the vault.")?;
        (
            account.cookie.clone(),
            account.place_id,
            account.use_global_perf,
            account.low_graphics,
            account.fps_cap,
        )
    };

    // The account's own game, unless this launch was for a specific place.
    let place_id = place_id.or(saved_place);

    // Take the lock back if it was lost, so this launch opens a new window
    // instead of focusing an existing one.
    singleton::ensure();

    // The account either follows the app-wide performance settings or brings
    // its own. Flags are read by the client at startup, so writing them here
    // only affects the client about to open.
    let global = prefs::load(&prefs_path(app)?);
    let (want_low, want_cap) = if use_global {
        (lowmem::is_active(), global.fps_cap)
    } else {
        (low_graphics, account_cap)
    };

    if want_low {
        // Idempotent: re-applies the flags if Roblox updated into a new version
        // folder since the last launch.
        if let Err(e) = lowmem::apply() {
            log::warn!("low memory: {e}");
        }
    } else {
        lowmem::restore();
    }

    // A client rewrites this file with its own values on exit, which wipes the
    // cap. Re-applying here means every launch is capped regardless.
    match want_cap {
        Some(cap) => {
            if let Err(e) = fps::apply(cap) {
                log::warn!("fps cap unavailable: {e}");
            }
        }
        None => fps::restore(),
    }

    // Claim the window that is about to appear, so the monitor can label it.
    clients::watch(id);

    let attempt = tauri::async_runtime::spawn_blocking(move || {
        let client = roblox::client().map_err(|message| roblox::TicketError {
            message,
            session_dead: false,
        })?;
        roblox::auth_ticket(&client, &cookie)
    })
    .await
    .map_err(|e| format!("Background task failed: {e}"))?;

    let ticket = match attempt {
        Ok(ticket) => ticket,
        Err(failure) => {
            // Roblox confirmed the session itself is gone: say so on the row
            // instead of leaving an "Active" account that can never launch.
            if failure.session_dead {
                if let Err(e) = mark_expired_by_id(app, state, id) {
                    log::warn!("could not mark the account expired: {e}");
                }
            }
            return Err(failure.message);
        }
    };

    if let Some(fresh) = &ticket.cookie {
        store_cookie(app, state, id, fresh);
    }

    // Three targets, most specific first: one named server of one place, any
    // server of a place, or just the client's home page.
    let uri = match (place_id, job_id.filter(|job| !job.is_empty())) {
        (Some(place), Some(job)) => roblox::play_uri_job(&ticket.value, place, job),
        (Some(place), None) => roblox::play_uri(&ticket.value, place),
        (None, _) => roblox::app_uri(&ticket.value),
    };

    roblox::open_url(&uri)?;

    // Remember where this account went, so a dropped client can be sent back to
    // the same lobby instead of a random one.
    if let (Some(place), Some(job)) = (place_id, job_id.filter(|job| !job.is_empty())) {
        if let Err(e) = store_last_server(app, state, id, place, job) {
            log::warn!("could not remember the server: {e}");
        }
    }

    Ok(uri)
}

/// Writes the place and job of the server an account was just sent into.
///
/// Like `store_cookie`, a failure here is logged rather than returned: the
/// client is already opening, and losing the bookmark changes nothing about
/// that launch.
fn store_last_server(
    app: &tauri::AppHandle,
    state: &VaultState,
    id: &str,
    place_id: u64,
    job_id: &str,
) -> Result<(), String> {
    let path = vault_path(app)?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_mut().ok_or("Vault is locked.")?;
    let Some(account) = session.data.accounts.iter_mut().find(|a| a.id == id) else {
        return Ok(());
    };

    account.last_place = Some(place_id);
    account.last_job = Some(job_id.to_string());
    account.last_job_at = Some(now());
    vault::save(session, &path)
}

/// Writes a rotated cookie back into the vault.
///
/// A failure here is logged, never returned: the client is already opening with
/// a valid ticket, and the next successful check will offer the cookie again.
fn store_cookie(app: &tauri::AppHandle, state: &VaultState, id: &str, cookie: &str) {
    let Ok(path) = vault_path(app) else {
        return;
    };
    let Ok(mut guard) = state.0.lock() else {
        return;
    };
    let Some(session) = guard.as_mut() else {
        return;
    };
    let Some(account) = session.data.accounts.iter_mut().find(|a| a.id == id) else {
        return;
    };

    account.cookie = cookie.to_string();
    match vault::save(session, &path) {
        Ok(()) => log::info!("stored a rotated Roblox cookie"),
        Err(e) => log::warn!("could not store the rotated cookie: {e}"),
    }
}

/// Flips one account to "signed out" and persists it.
fn mark_expired_by_id(
    app: &tauri::AppHandle,
    state: &VaultState,
    id: &str,
) -> Result<(), String> {
    let path = vault_path(app)?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_mut().ok_or("Vault is locked.")?;
    let Some(account) = session.data.accounts.iter_mut().find(|a| a.id == id) else {
        return Ok(());
    };
    mark_expired(account);
    vault::save(session, &path)
}

#[tauri::command]
async fn server_list(place_id: u64) -> Result<Vec<roblox::GameServer>, String> {
    blocking(move || {
        let client = roblox::client()?;
        roblox::servers(&client, place_id)
    })
    .await
}

#[tauri::command]
async fn roblox_protocol() -> Result<bool, String> {
    blocking(|| Ok(roblox::protocol_registered())).await
}

/// Saves an account's launch setup: the game it joins and how it renders.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn account_launch_config_set(
    app: tauri::AppHandle,
    state: tauri::State<'_, VaultState>,
    id: String,
    place_id: Option<u64>,
    place_name: String,
    place_icon: Option<String>,
    use_global_perf: bool,
    low_graphics: bool,
    fps_cap: Option<u32>,
) -> Result<AccountView, String> {
    let path = vault_path(&app)?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Vault state is unavailable.".to_string())?;
    let session = guard.as_mut().ok_or("Vault is locked.")?;
    let account = session
        .data
        .accounts
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or("That account is no longer in the vault.")?;

    account.place_id = place_id;
    account.place_name = place_name;
    account.place_icon = place_icon;
    account.use_global_perf = use_global_perf;
    account.low_graphics = low_graphics;
    account.fps_cap = fps_cap;

    let view = AccountView::from_account(account);
    vault::save(session, &path)?;
    Ok(view)
}

/// Names a place so the UI can show the game instead of a bare number.
#[tauri::command]
async fn place_lookup(place_id: u64) -> Result<roblox::PlaceInfo, String> {
    blocking(move || {
        let client = roblox::client()?;
        roblox::place_info(&client, place_id)
    })
    .await
}

/// Every Roblox client that is open right now, each tagged with the game it is
/// actually in when we can tell.
#[tauri::command]
async fn clients_list(
    state: tauri::State<'_, VaultState>,
) -> Result<Vec<clients::ClientWindow>, String> {
    let names: std::collections::HashMap<String, String> = {
        let guard = state
            .0
            .lock()
            .map_err(|_| "Vault state is unavailable.".to_string())?;
        guard
            .as_ref()
            .map(|session| {
                session
                    .data
                    .accounts
                    .iter()
                    .map(|account| (account.id.clone(), account.username.to_lowercase()))
                    .collect()
            })
            .unwrap_or_default()
    };

    // A client opened before this app (or in a previous run) is matched to its
    // saved account by the account its own log says it is signed into.
    let by_username: std::collections::HashMap<String, String> = names
        .iter()
        .map(|(id, username)| (username.clone(), id.clone()))
        .collect();

    blocking(move || {
        clients::adopt(&by_username);
        let mut list = clients::list();
        // Fall back to the username → place map when the client's own log hasn't
        // been read yet; the direct read is the accurate one.
        if list.iter().any(|client| client.account_id.is_some()) {
            let places = clients::places();
            for client in list.iter_mut() {
                if client.place_id.is_some() {
                    continue;
                }
                if let Some(username) = client.account_id.as_ref().and_then(|id| names.get(id)) {
                    client.place_id = places.get(username).copied();
                }
            }
        }
        Ok(list)
    })
    .await
}

#[tauri::command]
async fn client_focus(hwnd: i64) -> Result<(), String> {
    clients::focus(hwnd);
    Ok(())
}

/// Every open client, as a tiling slot. Reads the live window list rather than
/// anything cached, so a window opened a second ago is included.
fn tiling_slots() -> Vec<tiling::Slot> {
    clients::list()
        .into_iter()
        .map(|client| tiling::Slot { hwnd: client.hwnd })
        .filter(|slot| slot.hwnd != 0)
        .collect()
}

/// Lays every client out in a grid over the usable desktop.
#[tauri::command]
async fn tile_clients(size: Option<String>) -> Result<usize, String> {
    let slots = tiling_slots();
    if slots.is_empty() {
        return Err("No Roblox clients are open.".into());
    }
    let wanted = tiling::Size::from_str(size.as_deref().unwrap_or("normal"));
    tiling::tile(&slots, tiling::work_area(), wanted)
}

/// Tiles only the windows named, leaving every other client where it is.
///
/// This is how clients that share a server get gathered. The group is laid out
/// in one half of the desktop — the half it was already on — so the other half
/// stays free for whatever the user had there. `tile_clients` still uses the
/// whole work area.
#[tauri::command]
async fn tile_client_group(hwnds: Vec<i64>, size: Option<String>) -> Result<usize, String> {
    let slots: Vec<tiling::Slot> = hwnds
        .into_iter()
        .filter(|hwnd| *hwnd != 0)
        .map(|hwnd| tiling::Slot { hwnd })
        .collect();
    if slots.is_empty() {
        return Err("No windows in that group.".into());
    }
    let wanted = tiling::Size::from_str(size.as_deref().unwrap_or("normal"));
    let area = tiling::group_area(&slots, tiling::work_area());
    tiling::tile(&slots, area, wanted)
}

/// Minimises every client, so the desktop is clear without closing anything.
#[tauri::command]
async fn minimize_clients() -> Result<usize, String> {
    let slots = tiling_slots();
    if slots.is_empty() {
        return Err("No Roblox clients are open.".into());
    }
    Ok(tiling::minimise(&slots))
}

/// Restores every minimised client at the size it had before.
#[tauri::command]
async fn restore_clients() -> Result<usize, String> {
    let slots = tiling_slots();
    if slots.is_empty() {
        return Err("No Roblox clients are open.".into());
    }
    Ok(tiling::restore(&slots))
}

#[tauri::command]
async fn anti_afk_get() -> Result<bool, String> {
    Ok(antiafk::is_running())
}

/// Turns the background anti-AFK loop on or off.
#[tauri::command]
async fn anti_afk_set(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    if enabled {
        antiafk::start();
    } else {
        antiafk::stop();
    }

    let path = prefs_path(&app)?;
    let mut saved = prefs::load(&path);
    saved.anti_afk = enabled;
    prefs::save(&saved, &path)?;
    Ok(antiafk::is_running())
}

/// Brings the window back from the tray.
fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Puts StableAlt in the notification area, so anti-AFK, auto-rejoin and the
/// session sweep keep running with the window out of the way.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(icon) = app.default_window_icon().cloned() else {
        log::warn!("tray: no window icon to reuse");
        return Ok(());
    };

    let show = MenuItem::with_id(app, "show", "Open StableAlt", true, None::<&str>)?;
    let afk = CheckMenuItem::with_id(
        app,
        "afk",
        "Anti-AFK",
        true,
        antiafk::is_running(),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit StableAlt", true, None::<&str>)?;
    let divider = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&show, &afk, &divider, &quit])?;

    TrayIconBuilder::with_id("stablealt")
        .icon(icon)
        .tooltip("StableAlt")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "afk" => {
                let on = !antiafk::is_running();
                if on {
                    antiafk::start();
                } else {
                    antiafk::stop();
                }
                if let Ok(path) = prefs_path(app) {
                    let mut saved = prefs::load(&path);
                    saved.anti_afk = on;
                    let _ = prefs::save(&saved, &path);
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Turning this off makes closing the window quit, like any other app.
#[tauri::command]
async fn close_to_tray_set(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<prefs::Prefs, String> {
    let path = prefs_path(&app)?;
    let mut saved = prefs::load(&path);
    saved.close_to_tray = enabled;
    prefs::save(&saved, &path)?;
    Ok(saved)
}

/// Turns auto-rejoin on or off. The watcher itself reads this each tick, so
/// nothing needs restarting when it changes.
#[tauri::command]
async fn auto_rejoin_set(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<prefs::Prefs, String> {
    let path = prefs_path(&app)?;
    let mut saved = prefs::load(&path);
    saved.auto_rejoin = enabled;
    prefs::save(&saved, &path)?;
    Ok(saved)
}

#[tauri::command]
async fn low_memory_get() -> Result<bool, String> {
    Ok(lowmem::is_active())
}

#[tauri::command]
async fn low_memory_set(enabled: bool) -> Result<bool, String> {
    if enabled {
        blocking(lowmem::apply).await?;
    } else {
        lowmem::restore();
    }
    Ok(lowmem::is_active())
}

#[tauri::command]
async fn prefs_get(app: tauri::AppHandle) -> Result<prefs::Prefs, String> {
    Ok(prefs::load(&prefs_path(&app)?))
}

/// Switches theme. Presets and saved themes go through the same check, because
/// the colour strings end up in CSS variables.
#[tauri::command]
async fn theme_set(app: tauri::AppHandle, theme: prefs::Theme) -> Result<prefs::Prefs, String> {
    if !prefs::is_valid(&theme) {
        return Err("That theme has a colour that isn't a hex value like #ff6a4d.".to_string());
    }

    let path = prefs_path(&app)?;
    let mut saved = prefs::load(&path);
    saved.theme = theme;
    prefs::save(&saved, &path)?;
    Ok(saved)
}

/// Saves a theme the user built, replacing any earlier one with the same id, and
/// switches to it so the window and the file never disagree.
#[tauri::command]
async fn theme_save_custom(
    app: tauri::AppHandle,
    theme: prefs::Theme,
) -> Result<prefs::Prefs, String> {
    if !prefs::is_valid(&theme) {
        return Err("That theme has a colour that isn't a hex value like #ff6a4d.".to_string());
    }

    let path = prefs_path(&app)?;
    let mut saved = prefs::load(&path);
    match saved.custom_themes.iter_mut().find(|t| t.id == theme.id) {
        Some(existing) => *existing = theme.clone(),
        None => saved.custom_themes.push(theme.clone()),
    }
    saved.theme = theme;
    prefs::save(&saved, &path)?;
    Ok(saved)
}

/// Drops a saved theme. If it was the one in use, Ember takes over.
#[tauri::command]
async fn theme_delete_custom(app: tauri::AppHandle, id: String) -> Result<prefs::Prefs, String> {
    let path = prefs_path(&app)?;
    let mut saved = prefs::load(&path);
    saved.custom_themes.retain(|theme| theme.id != id);
    if saved.theme.id == id {
        saved.theme = prefs::Theme::default();
    }
    prefs::save(&saved, &path)?;
    Ok(saved)
}

/// Turns the background session monitor on or off.
#[tauri::command]
async fn session_monitor_set(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<prefs::Prefs, String> {
    let path = prefs_path(&app)?;
    let mut saved = prefs::load(&path);
    saved.monitor_sessions = enabled;
    prefs::save(&saved, &path)?;
    Ok(saved)
}

/// Answers the first-run multi-instance question. Always records the answer, so
/// the question is asked once even when enabling fails right now.
#[tauri::command]
async fn onboarding_done(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<prefs::Prefs, String> {
    let path = prefs_path(&app)?;
    let mut saved = prefs::load(&path);

    if enabled {
        if let Err(e) = singleton::acquire() {
            log::warn!("multi-instance unavailable: {e}");
        }
    } else {
        let _ = singleton::release();
    }

    saved.multi_instance = singleton::is_active();
    saved.multi_instance_asked = true;
    prefs::save(&saved, &path)?;
    Ok(saved)
}

#[tauri::command]
async fn fps_cap_set(
    app: tauri::AppHandle,
    cap: Option<u32>,
) -> Result<prefs::Prefs, String> {
    if let Some(value) = cap {
        if !(5..=360).contains(&value) {
            return Err("Pick a frame-rate cap between 5 and 360 FPS.".to_string());
        }
    }

    match cap {
        Some(value) => blocking(move || fps::apply(value)).await?,
        None => fps::restore(),
    }

    let path = prefs_path(&app)?;
    let mut saved = prefs::load(&path);
    saved.fps_cap = cap;
    prefs::save(&saved, &path)?;
    Ok(saved)
}

#[tauri::command]
async fn multi_instance_get() -> Result<bool, String> {
    Ok(singleton::is_active())
}

#[tauri::command]
async fn multi_instance_set(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<bool, String> {
    if enabled {
        singleton::acquire()?;
    } else {
        singleton::release()?;
    }

    let active = singleton::is_active();
    let path = prefs_path(&app)?;
    let mut saved = prefs::load(&path);
    saved.multi_instance = active;
    prefs::save(&saved, &path)?;
    Ok(active)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(VaultState::new())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            if std::env::var("STABLEALT_GAMES").is_ok() {
                log::info!("GAMES {:?}", clients::places());
                std::process::exit(0);
            }

            // Honour what the user chose last time. Multi-instance is on by
            // default; after the logger, so the outcome reaches the log.
            let handle = app.handle().clone();
            let saved = prefs_path(&handle).map(|path| prefs::load(&path)).unwrap_or_default();

            if saved.multi_instance {
                if let Err(e) = singleton::acquire() {
                    log::warn!("multi-instance unavailable: {e}");
                }
            }

            if let Some(cap) = saved.fps_cap {
                if let Err(e) = fps::apply(cap) {
                    log::warn!("fps cap unavailable: {e}");
                }
            }

            // Also on by default: every client this app starts should be as
            // light as Roblox allows.
            if let Err(e) = lowmem::apply() {
                log::warn!("low memory unavailable: {e}");
            }

            // Anti-AFK is off unless the user asked for it last time.
            if saved.anti_afk {
                antiafk::start();
            }

            // A client opened last time keeps its account if it is still running,
            // so reopening the app doesn't show it as an unknown window.
            if let Ok(path) = bindings_path(&handle) {
                clients::set_bindings_path(path);
                clients::restore_bindings();
            }

            // Watches the clients this app launches and reopens the ones that
            // close. Does nothing until something has been launched.
            rejoin::start(handle.clone());

            if let Err(e) = build_tray(&handle) {
                log::warn!("tray unavailable: {e}");
            }

            // Closing the window keeps the app alive in the tray by default, so
            // a launched client still gets anti-AFK and a rejoin after a crash.
            if let Some(window) = app.get_webview_window("main") {
                let handle = handle.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let keep = prefs_path(&handle)
                            .map(|path| prefs::load(&path).close_to_tray)
                            .unwrap_or(true);
                        if keep {
                            api.prevent_close();
                            if let Some(window) = handle.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_status,
            vault_create,
            vault_unlock,
            vault_lock,
            accounts_list,
            account_add,
            accounts_bulk_add,
            account_refresh,
            account_refresh_all,
            accounts_check_sessions,
            session_monitor_set,
            account_update,
            account_recookie,
            account_remove,
            account_cookie,
            backup_export,
            backup_import,
            launch_account,
            server_list,
            account_launch_config_set,
            place_lookup,
            clients_list,
            client_focus,
            tile_clients,
            tile_client_group,
            minimize_clients,
            restore_clients,
            roblox_protocol,
            multi_instance_get,
            multi_instance_set,
            anti_afk_get,
            anti_afk_set,
            low_memory_get,
            low_memory_set,
            auto_rejoin_set,
            close_to_tray_set,
            prefs_get,
            theme_set,
            theme_save_custom,
            theme_delete_custom,
            onboarding_done,
            fps_cap_set,
            friends_list,
            friend_accept,
            friend_decline,
            friend_send
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, event| {
            // Leave the machine as we found it: original client flags back,
            // and the singleton lock released.
            if matches!(event, tauri::RunEvent::Exit) {
                antiafk::stop();
                lowmem::restore();
                fps::restore();
                let _ = singleton::release();
            }
        });
}
