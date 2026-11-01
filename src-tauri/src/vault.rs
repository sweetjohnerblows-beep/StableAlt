//! Encrypted local vault.
//!
//! On disk the vault is a small JSON envelope: Argon2id parameters, a random
//! nonce, and the AES-256-GCM ciphertext of the account list. Cookies never
//! touch disk in plaintext.

use aes_gcm::{
    aead::{rand_core::RngCore, Aead, OsRng},
    Aes256Gcm, KeyInit, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::path::Path;

const VAULT_VERSION: u32 = 1;
const SALT_LEN: usize = 16;
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const MIN_PASSWORD: usize = 8;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct KdfParams {
    pub salt: String,
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Account {
    pub id: String,
    pub cookie: String,
    pub user_id: i64,
    pub username: String,
    pub display_name: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub robux: Option<i64>,
    #[serde(default = "unknown_status")]
    pub status: String,
    #[serde(default)]
    pub checked_at: Option<String>,
    #[serde(default)]
    pub added_at: String,
    /// The place this account joins by default. `None` opens Roblox's home page.
    #[serde(default)]
    pub place_id: Option<u64>,
    #[serde(default)]
    pub place_name: String,
    #[serde(default)]
    pub place_icon: Option<String>,
    /// Follow the app-wide graphics / frame-rate settings. Turning this off lets
    /// one account keep normal graphics while the rest stay at the minimum.
    #[serde(default = "yes")]
    pub use_global_perf: bool,
    #[serde(default)]
    pub low_graphics: bool,
    #[serde(default)]
    pub fps_cap: Option<u32>,
}

fn yes() -> bool {
    true
}

fn unknown_status() -> String {
    "unknown".to_string()
}

/// What the UI is allowed to see. The cookie is deliberately absent.
#[derive(Serialize, Clone, Debug)]
pub struct AccountView {
    pub id: String,
    pub user_id: i64,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub note: String,
    pub tags: Vec<String>,
    pub robux: Option<i64>,
    pub status: String,
    pub checked_at: Option<String>,
    pub added_at: String,
    pub place_id: Option<u64>,
    pub place_name: String,
    pub place_icon: Option<String>,
    pub use_global_perf: bool,
    pub low_graphics: bool,
    pub fps_cap: Option<u32>,
}

impl AccountView {
    pub fn from_account(a: &Account) -> Self {
        Self {
            id: a.id.clone(),
            user_id: a.user_id,
            username: a.username.clone(),
            display_name: a.display_name.clone(),
            avatar_url: a.avatar_url.clone(),
            note: a.note.clone(),
            tags: a.tags.clone(),
            robux: a.robux,
            status: a.status.clone(),
            checked_at: a.checked_at.clone(),
            added_at: a.added_at.clone(),
            place_id: a.place_id,
            place_name: a.place_name.clone(),
            place_icon: a.place_icon.clone(),
            use_global_perf: a.use_global_perf,
            low_graphics: a.low_graphics,
            fps_cap: a.fps_cap,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct VaultData {
    #[serde(default)]
    pub accounts: Vec<Account>,
}

#[derive(Serialize, Deserialize, Debug)]
struct VaultFile {
    version: u32,
    kdf: KdfParams,
    nonce: String,
    ciphertext: String,
}

/// An unlocked vault. The derived key lives here and only here.
pub struct Session {
    key: [u8; KEY_LEN],
    pub kdf: KdfParams,
    pub data: VaultData,
}

fn derive_key(password: &str, kdf: &KdfParams) -> Result<[u8; KEY_LEN], String> {
    let salt = B64
        .decode(&kdf.salt)
        .map_err(|_| "Vault salt is corrupt.".to_string())?;
    let params = Params::new(kdf.m_cost, kdf.t_cost, kdf.p_cost, Some(KEY_LEN))
        .map_err(|e| format!("Bad KDF parameters: {e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; KEY_LEN];
    argon
        .hash_password_into(password.as_bytes(), &salt, &mut key)
        .map_err(|_| "Could not derive a key from that password.".to_string())?;
    Ok(key)
}

fn fresh_kdf() -> KdfParams {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    // 64 MiB / 3 passes / 1 lane: ~100-200 ms on a desktop CPU.
    KdfParams {
        salt: B64.encode(salt),
        m_cost: 65_536,
        t_cost: 3,
        p_cost: 1,
    }
}

pub fn create(password: &str, path: &Path) -> Result<Session, String> {
    if path.exists() {
        return Err("A vault already exists on this device.".to_string());
    }
    if password.chars().count() < MIN_PASSWORD {
        return Err(format!(
            "Use at least {MIN_PASSWORD} characters for the master password."
        ));
    }
    let kdf = fresh_kdf();
    let key = derive_key(password, &kdf)?;
    let session = Session {
        key,
        kdf,
        data: VaultData::default(),
    };
    save(&session, path)?;
    Ok(session)
}

pub fn open(password: &str, path: &Path) -> Result<Session, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|_| "No vault found on this device.".to_string())?;
    let file: VaultFile =
        serde_json::from_str(&raw).map_err(|_| "Vault file is corrupt.".to_string())?;
    if file.version != VAULT_VERSION {
        return Err(format!(
            "Vault version {} is not supported by this build.",
            file.version
        ));
    }
    let key = derive_key(password, &file.kdf)?;
    let cipher =
        Aes256Gcm::new_from_slice(&key).map_err(|_| "Vault key is invalid.".to_string())?;
    let nonce_bytes = B64
        .decode(&file.nonce)
        .map_err(|_| "Vault nonce is corrupt.".to_string())?;
    if nonce_bytes.len() != NONCE_LEN {
        return Err("Vault nonce is corrupt.".to_string());
    }
    let ciphertext = B64
        .decode(&file.ciphertext)
        .map_err(|_| "Vault body is corrupt.".to_string())?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_ref())
        .map_err(|_| "Wrong master password.".to_string())?;
    let data: VaultData = serde_json::from_slice(&plaintext)
        .map_err(|_| "Vault contents are corrupt.".to_string())?;
    Ok(Session {
        key,
        kdf: file.kdf,
        data,
    })
}

pub fn save(session: &Session, path: &Path) -> Result<(), String> {
    let cipher = Aes256Gcm::new_from_slice(&session.key)
        .map_err(|_| "Vault key is invalid.".to_string())?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let plaintext = serde_json::to_vec(&session.data).map_err(|e| e.to_string())?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_ref())
        .map_err(|_| "Encryption failed.".to_string())?;
    let file = VaultFile {
        version: VAULT_VERSION,
        kdf: session.kdf.clone(),
        nonce: B64.encode(nonce_bytes),
        ciphertext: B64.encode(ciphertext),
    };
    let json = serde_json::to_vec_pretty(&file).map_err(|e| e.to_string())?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Could not create vault dir: {e}"))?;
    }
    // Write beside the real file first so a crash can never leave a half vault.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json).map_err(|e| format!("Could not write vault: {e}"))?;
    if path.exists() {
        let _ = std::fs::copy(path, path.with_extension("json.bak"));
        let _ = std::fs::remove_file(path);
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("Could not save vault: {e}"))?;
    Ok(())
}
