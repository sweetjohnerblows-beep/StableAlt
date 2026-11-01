//! Everything that talks to Roblox.
//!
//! Roblox has no public account-management API. These are the same endpoints a
//! browser uses: `users.roblox.com/v1/users/authenticated` to identify a cookie,
//! `auth.roblox.com/v1/authentication-ticket` to mint the launch ticket, and the
//! `roblox-player:` protocol to hand that ticket to the installed client.

use reqwest::blocking::Client;
use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, CONTENT_TYPE, COOKIE, ORIGIN, REFERER, SET_COOKIE,
};
use serde::{Deserialize, Serialize};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const AUTHED_USER: &str = "https://users.roblox.com/v1/users/authenticated";
const CURRENCY: &str = "https://economy.roblox.com/v1/user/currency";
const TICKET: &str = "https://auth.roblox.com/v1/authentication-ticket";
const AVATAR: &str = "https://thumbnails.roblox.com/v1/users/avatar-headshot";
const FRIEND_REQUESTS: &str = "https://friends.roblox.com/v1/my/friends/requests";
const FRIENDS: &str = "https://friends.roblox.com/v1/users";
const USERNAMES: &str = "https://users.roblox.com/v1/usernames/users";

#[derive(Clone, Debug)]
pub struct SessionInfo {
    pub user_id: i64,
    pub username: String,
    pub display_name: String,
    pub robux: Option<i64>,
    pub avatar_url: Option<String>,
    /// Roblox rotates `.ROBLOSECURITY` on its own schedule and announces it with
    /// `Set-Cookie`. A launcher that ignores that keeps launching with a cookie
    /// that is about to die, which shows up much later as a 9002.
    pub cookie: Option<String>,
}

/// The `.ROBLOSECURITY` value a response asked us to adopt, if any.
///
/// Roblox's rule is deliberately simple: if a response carries this cookie, the
/// client should overwrite what it stored. Length and whitespace checks keep an
/// error page or a half-parsed header from replacing a working cookie.
fn rotated_cookie(headers: &HeaderMap) -> Option<String> {
    for header in headers.get_all(SET_COOKIE) {
        let Ok(text) = header.to_str() else {
            continue;
        };
        for part in text.split(',') {
            let Some(rest) = part.trim().strip_prefix(".ROBLOSECURITY=") else {
                continue;
            };
            let value = rest.split(';').next().unwrap_or("").trim();
            if value.len() > 200 && !value.chars().any(char::is_whitespace) {
                return Some(value.to_string());
            }
        }
    }
    None
}

#[derive(Deserialize)]
struct AuthedUser {
    id: i64,
    name: String,
    #[serde(default)]
    display_name: Option<String>,
}

#[derive(Deserialize)]
struct CurrencyBody {
    robux: i64,
}

#[derive(Deserialize)]
struct ThumbnailBody {
    #[serde(default)]
    data: Vec<ThumbnailItem>,
}

#[derive(Deserialize)]
struct ThumbnailItem {
    #[serde(default, rename = "imageUrl")]
    image_url: Option<String>,
}

pub fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(25))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Could not start HTTP client: {e}"))
}

fn cookie_header(cookie: &str) -> String {
    format!(".ROBLOSECURITY={}", normalize_cookie(cookie))
}

/// Accepts a bare cookie value or a `name=value` pair pasted from devtools.
///
/// Cookie values are printable ASCII and never contain whitespace (RFC 6265),
/// so anything else is paste damage — a wrapped DevTools cell, a stray newline,
/// a tab from copying Name and Value together.
///
/// Double quotes are the important case: a cookie value may never contain one,
/// and Roblox drops the entire cookie when it does. It answers
/// `9002 Authentication token is missing`, which looks exactly like an expired
/// session even though the cookie itself is perfectly good.
pub fn normalize_cookie(input: &str) -> String {
    let trimmed = input.trim();
    let unlabelled = trimmed
        .strip_prefix("Cookie:")
        .or_else(|| trimmed.strip_prefix("cookie:"))
        .unwrap_or(trimmed)
        .trim();
    let bare = unlabelled
        .strip_prefix(".ROBLOSECURITY=")
        .or_else(|| unlabelled.strip_prefix(".roblosecurity="))
        .unwrap_or(unlabelled);

    let cleaned: String = bare
        .chars()
        .filter(|c| c.is_ascii_graphic() && *c != '"')
        .collect();
    cleaned.trim_end_matches(';').to_string()
}

/// Builds the authenticated header set. Never degrades to an empty cookie:
/// Roblox answers that with `9002 Authentication token is missing`, which is
/// impossible to tell apart from a revoked session.
fn auth_headers(cookie: &str) -> Result<HeaderMap, String> {
    let value = cookie_header(cookie);
    if normalize_cookie(cookie).is_empty() {
        return Err("This account has no cookie saved. Remove it and add it again.".to_string());
    }
    let cookie_value = HeaderValue::from_str(&value).map_err(|_| {
        "The saved cookie contains characters that can't be sent to Roblox. Remove the account and paste the cookie again."
            .to_string()
    })?;

    let mut h = HeaderMap::new();
    h.insert(COOKIE, cookie_value);
    h.insert(ORIGIN, HeaderValue::from_static("https://www.roblox.com"));
    h.insert(REFERER, HeaderValue::from_static("https://www.roblox.com/home"));
    h.insert(ACCEPT, HeaderValue::from_static("application/json"));
    h.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    Ok(h)
}

/// Identifies the account behind a cookie. This is also the validity check.
pub fn fetch_session(client: &Client, cookie: &str) -> Result<SessionInfo, String> {
    let resp = client
        .get(AUTHED_USER)
        .headers(auth_headers(cookie)?)
        .send()
        .map_err(|e| format!("Could not reach Roblox: {e}"))?;

    let rotated = rotated_cookie(resp.headers());
    let status = resp.status().as_u16();
    if status == 401 || status == 403 {
        return Err("Roblox rejected this session — the account is logged out or the cookie was revoked.".to_string());
    }
    if !(200..300).contains(&status) {
        return Err(format!("Roblox returned HTTP {status} while checking the session."));
    }

    let user: AuthedUser = resp
        .json()
        .map_err(|e| format!("Unexpected response from Roblox: {e}"))?;

    let robux = fetch_robux(client, cookie);
    let avatar_url = fetch_avatar(client, user.id);

    Ok(SessionInfo {
        user_id: user.id,
        username: user.name.clone(),
        display_name: user.display_name.unwrap_or(user.name),
        robux,
        avatar_url,
        cookie: rotated,
    })
}

/// Result of a cheap session check: no balance, no avatar, one request.
pub enum SessionCheck {
    Valid,
    /// Roblox said the cookie is no longer signed in.
    Expired,
    /// Couldn't tell — offline, rate limited, Roblox down. Leave the account
    /// as it was rather than calling it expired.
    Unknown,
}

/// The monitoring path: one request per account, no side effects.
pub fn check_session(client: &Client, cookie: &str) -> SessionCheck {
    let Ok(headers) = auth_headers(cookie) else {
        return SessionCheck::Expired;
    };

    let Ok(resp) = client.get(AUTHED_USER).headers(headers).send() else {
        return SessionCheck::Unknown;
    };

    match resp.status().as_u16() {
        200..=299 => SessionCheck::Valid,
        401 | 403 => SessionCheck::Expired,
        _ => SessionCheck::Unknown,
    }
}

fn fetch_robux(client: &Client, cookie: &str) -> Option<i64> {
    let resp = client
        .get(CURRENCY)
        .headers(auth_headers(cookie).ok()?)
        .send()
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<CurrencyBody>().ok().map(|b| b.robux)
}

fn fetch_avatar(client: &Client, user_id: i64) -> Option<String> {
    let url = format!("{AVATAR}?userIds={user_id}&size=150x150&format=Png&isCircular=false");
    let resp = client.get(url).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<ThumbnailBody>()
        .ok()?
        .data
        .into_iter()
        .find_map(|i| i.image_url)
}

#[derive(Deserialize)]
struct ErrorBody {
    #[serde(default)]
    errors: Vec<ApiError>,
}

#[derive(Deserialize)]
struct ApiError {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
}

/// Turns Roblox's error body into one readable clause, e.g.
/// `HTTP 401 · User is not authenticated (code 9002)`.
fn describe_failure(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<ErrorBody>(body)
        .ok()
        .and_then(|b| b.errors.into_iter().next())
        .map(|e| {
            if e.code == 0 {
                e.message
            } else {
                format!("{} (code {})", e.message, e.code)
            }
        })
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| body.trim().chars().take(140).collect());

    if detail.is_empty() {
        format!("HTTP {status}")
    } else {
        format!("HTTP {status} · {detail}")
    }
}

/// A minted launch ticket, plus a rotated cookie if Roblox handed one back.
#[derive(Clone, Debug)]
pub struct Ticket {
    pub value: String,
    pub cookie: Option<String>,
}

/// Why a launch failed, and whether the session itself is gone.
#[derive(Clone, Debug)]
pub struct TicketError {
    pub message: String,
    /// Roblox no longer recognises the cookie at all, so re-adding is the only
    /// way forward. False means the cookie is fine and the ticket request was
    /// refused for some other reason.
    pub session_dead: bool,
}

/// Cheap identity check, used to tell "this cookie is dead" apart from
/// "auth.roblox.com hiccuped while the session is perfectly alive".
fn session_alive(client: &Client, cookie: &str) -> bool {
    let Ok(headers) = auth_headers(cookie) else {
        return false;
    };
    client
        .get(AUTHED_USER)
        .headers(headers)
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Mints a one-shot auth ticket. Roblox requires the CSRF dance: the first
/// request usually comes back 403 with an `x-csrf-token` header, and the retry
/// carrying that header succeeds.
///
/// A 401 with `9002 Authentication token is missing` is not automatically a dead
/// cookie: Roblox rotates `.ROBLOSECURITY` on its own schedule and quietly stops
/// honouring the old value, so the vault can hold a cookie that still browses but
/// no longer mints tickets. Every response is checked for a replacement cookie and
/// handed back to the caller to store. If a 401 still happens, the session is
/// re-probed and the ticket requested once more — no point telling the user to
/// re-add an account that is actually fine.
///
/// Nothing secret is ever logged: only the HTTP status and Roblox's message.
pub fn auth_ticket(client: &Client, cookie: &str) -> Result<Ticket, TicketError> {
    let mut csrf: Option<String> = None;
    let mut failure: Option<(u16, String)> = None;
    let mut rotated: Option<String> = None;
    let mut reprobed = false;
    log::info!(
        "launch ticket: sending {} characters of cookie",
        normalize_cookie(cookie).len()
    );

    for _ in 0..4 {
        let headers = auth_headers(cookie).map_err(|message| TicketError {
            message,
            session_dead: false,
        })?;
        let mut request = client
            .post(TICKET)
            .headers(headers)
            .header("Sec-Fetch-Site", "same-site")
            .header("Sec-Fetch-Mode", "cors")
            .header("Sec-Fetch-Dest", "empty")
            .body("{}");

        if let Some(token) = &csrf {
            request = request.header("X-CSRF-TOKEN", token);
        }

        let response = request.send().map_err(|e| TicketError {
            message: format!("Could not reach Roblox: {e}"),
            session_dead: false,
        })?;

        let status = response.status().as_u16();
        let issued_token = response
            .headers()
            .get("x-csrf-token")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);

        if let Some(fresh) = rotated_cookie(response.headers()) {
            log::info!("authentication-ticket: Roblox rotated the cookie, storing it");
            rotated = Some(fresh);
        }

        if (200..300).contains(&status) {
            return response
                .headers()
                .get("rbx-authentication-ticket")
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned)
                .filter(|t| !t.is_empty())
                .map(|value| Ticket {
                    value,
                    cookie: rotated.clone(),
                })
                .ok_or_else(|| TicketError {
                    message: "Roblox accepted the session but returned no ticket. Try again."
                        .to_string(),
                    session_dead: false,
                });
        }

        let body = response.text().unwrap_or_default();
        let described = describe_failure(status, &body);

        // A fresh CSRF token on a 403 is an instruction, not a dead end: retry
        // with it. The first such 403 is normal, so it must not be logged as a
        // failure — a successful launch would leave scary noise in the log.
        // Any other status (401 above all) will not improve by retrying.
        if status == 403 {
            if let Some(token) = issued_token {
                if csrf.as_deref() != Some(token.as_str()) {
                    log::info!("authentication-ticket: CSRF token issued, retrying");
                    csrf = Some(token);
                    failure = Some((status, described));
                    continue;
                }
            }
        }

        // A 401 on the ticket call is worth one honest second opinion: the
        // session probe uses a different host and tells us whether the cookie is
        // actually gone or auth.roblox.com just refused this one request.
        if status == 401 && !reprobed {
            reprobed = true;
            if session_alive(client, cookie) {
                log::info!("authentication-ticket: 401 but the session is alive, retrying once");
                std::thread::sleep(Duration::from_millis(700));
                failure = Some((status, described));
                continue;
            }
            log::warn!("authentication-ticket: session probe also rejected ({described})");
            return Err(TicketError {
                message: format!(
                    "This account's session has expired — Roblox no longer accepts the saved cookie ({described}). Sign in again on roblox.com, copy a fresh cookie and re-add the account."
                ),
                session_dead: true,
            });
        }

        log::warn!("authentication-ticket failed: {described}");
        failure = Some((status, described));
        break;
    }

    let (status, detail) = failure.unwrap_or((0, "no response".to_string()));
    Err(TicketError {
        message: match status {
            401 => format!(
                "Roblox keeps refusing to mint a launch ticket for this session ({detail}), even though the cookie still works for browsing. That usually means the session was rotated or signed out on Roblox's side — sign in again on roblox.com and re-add the account."
            ),
            403 => format!(
                "Roblox blocked the launch ticket request ({detail}). This is usually their anti-bot check or a session that was just revoked — try again in a moment, then re-add the account with a fresh cookie."
            ),
            _ => format!("Roblox refused the launch ticket ({detail})."),
        },
        session_dead: status == 401,
    })
}

/// One pending incoming friend request, shaped for the UI.
#[derive(Clone, Debug, Serialize)]
pub struct FriendRequest {
    pub user_id: i64,
    pub username: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub created: Option<String>,
}

#[derive(Deserialize)]
struct RequestsBody {
    #[serde(default)]
    data: Vec<RequestItem>,
}

#[derive(Deserialize)]
struct RequestItem {
    #[serde(default)]
    id: i64,
    #[serde(default)]
    name: String,
    #[serde(default, rename = "displayName")]
    display_name: Option<String>,
    #[serde(default)]
    created: Option<String>,
}

#[derive(Deserialize)]
struct ThumbBatch {
    #[serde(default)]
    data: Vec<ThumbBatchItem>,
}

#[derive(Deserialize)]
struct ThumbBatchItem {
    #[serde(default, rename = "targetId")]
    target_id: i64,
    #[serde(default, rename = "imageUrl")]
    image_url: Option<String>,
}

#[derive(Deserialize)]
struct UsernameLookup {
    #[serde(default)]
    data: Vec<UsernameHit>,
}

#[derive(Deserialize)]
struct UsernameHit {
    #[serde(default)]
    id: i64,
    #[serde(default)]
    name: String,
    #[serde(default, rename = "displayName")]
    display_name: Option<String>,
}

/// Headshots for several users in one call.
fn fetch_avatars(client: &Client, ids: &[i64]) -> std::collections::HashMap<i64, String> {
    let mut out = std::collections::HashMap::new();
    if ids.is_empty() {
        return out;
    }
    let list = ids
        .iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let url = format!("{AVATAR}?userIds={list}&size=150x150&format=Png&isCircular=false");
    let Ok(resp) = client.get(url).send() else {
        return out;
    };
    if !resp.status().is_success() {
        return out;
    }
    if let Ok(body) = resp.json::<ThumbBatch>() {
        for item in body.data {
            if let Some(url) = item.image_url {
                out.insert(item.target_id, url);
            }
        }
    }
    out
}

/// A POST with Roblox's CSRF handshake: the first attempt is rejected with 403
/// and an `x-csrf-token` header, and the retry carrying it succeeds. Tokens
/// rotate, so each attempt uses whatever the last response handed back.
pub fn post_json(
    client: &Client,
    cookie: &str,
    url: &str,
    body: &str,
) -> Result<reqwest::blocking::Response, String> {
    let mut csrf: Option<String> = None;
    let mut failure: Option<(u16, String)> = None;

    for _ in 0..3 {
        let mut request = client
            .post(url)
            .headers(auth_headers(cookie)?)
            .body(body.to_string());
        if let Some(token) = &csrf {
            request = request.header("X-CSRF-TOKEN", token);
        }

        let response = request
            .send()
            .map_err(|e| format!("Could not reach Roblox: {e}"))?;
        let status = response.status().as_u16();

        if (200..300).contains(&status) {
            return Ok(response);
        }

        let token = response
            .headers()
            .get("x-csrf-token")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let text = response.text().unwrap_or_default();
        let described = describe_failure(status, &text);

        if status == 403 {
            if let Some(token) = token {
                if csrf.as_deref() != Some(token.as_str()) {
                    csrf = Some(token);
                    failure = Some((status, described));
                    continue;
                }
            }
        }

        failure = Some((status, described));
        break;
    }

    let (status, detail) = failure.unwrap_or((0, "no response".to_string()));
    Err(match status {
        429 => format!("Roblox is rate limiting friend changes ({detail}). Wait a minute, then try again."),
        401 | 403 => format!("Roblox refused that ({detail}). Refresh the account — the session may have expired."),
        _ => format!("Roblox refused that ({detail})."),
    })
}

/// Roblox often answers 200 with `{"success":false,"message":…}`; treat that
/// as the failure it is instead of reporting success.
fn ensure_success(response: reqwest::blocking::Response) -> Result<(), String> {
    let text = response.text().unwrap_or_default();
    if let Ok(body) = serde_json::from_str::<serde_json::Value>(&text) {
        if body.get("success").and_then(|s| s.as_bool()) == Some(false) {
            let reason = body
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Roblox refused that.");
            return Err(reason.to_string());
        }
    }
    Ok(())
}

/// Pending incoming friend requests for the session's own account.
pub fn friend_requests(client: &Client, cookie: &str) -> Result<Vec<FriendRequest>, String> {
    let url = format!("{FRIEND_REQUESTS}?limit=50&sortOrder=Asc");
    let response = client
        .get(url)
        .headers(auth_headers(cookie)?)
        .send()
        .map_err(|e| format!("Could not reach Roblox: {e}"))?;

    let status = response.status().as_u16();
    if status == 401 || status == 403 {
        return Err(
            "Roblox rejected this session, so friend requests can't be read. Refresh the account."
                .to_string(),
        );
    }
    if !(200..300).contains(&status) {
        let text = response.text().unwrap_or_default();
        return Err(format!(
            "Roblox returned {} while reading requests.",
            describe_failure(status, &text)
        ));
    }

    let body: RequestsBody = response
        .json()
        .map_err(|e| format!("Unexpected response from Roblox: {e}"))?;

    let ids: Vec<i64> = body.data.iter().map(|item| item.id).collect();
    let avatars = fetch_avatars(client, &ids);

    Ok(body
        .data
        .into_iter()
        .map(|item| FriendRequest {
            user_id: item.id,
            display_name: item.display_name.unwrap_or_else(|| item.name.clone()),
            avatar_url: avatars.get(&item.id).cloned(),
            created: item.created,
            username: item.name,
        })
        .collect())
}

pub fn accept_friend(client: &Client, cookie: &str, user_id: i64) -> Result<(), String> {
    let url = format!("{FRIENDS}/{user_id}/accept-friend-request");
    ensure_success(post_json(client, cookie, &url, "{}")?)
}

pub fn decline_friend(client: &Client, cookie: &str, user_id: i64) -> Result<(), String> {
    let url = format!("{FRIENDS}/{user_id}/decline-friend-request");
    ensure_success(post_json(client, cookie, &url, "{}")?)
}

/// Sends a request to `username`; returns the username Roblox actually matched.
/// Usernames are resolved first so the user gets a real answer for a typo.
pub fn send_friend_request(client: &Client, cookie: &str, username: &str) -> Result<String, String> {
    let handle = username.trim().trim_start_matches('@');
    if handle.is_empty() {
        return Err("Type a username first.".to_string());
    }

    let lookup = serde_json::json!({ "usernames": [handle], "excludeBannedUsers": true }).to_string();
    let found = post_json(client, cookie, USERNAMES, &lookup)?;
    let body: UsernameLookup = found
        .json()
        .map_err(|e| format!("Unexpected response from Roblox: {e}"))?;
    let hit = body
        .data
        .into_iter()
        .next()
        .ok_or_else(|| format!("No Roblox account is named \"{handle}\"."))?;

    let url = format!("{FRIENDS}/{}/request-friendship", hit.id);
    let response = post_json(client, cookie, &url, "{}")?;
    let text = response.text().unwrap_or_default();
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
        if value.get("success").and_then(|s| s.as_bool()) == Some(false) {
            let reason = value
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("Roblox refused the friend request.");
            return Err(reason.to_string());
        }
    }

    Ok(if hit.name.is_empty() {
        handle.to_string()
    } else {
        hit.name
    })
}

/// What a place looks like in the UI: its name, who made it, and its icon.
#[derive(Clone, Debug, Serialize)]
pub struct PlaceInfo {
    pub place_id: u64,
    pub universe_id: i64,
    pub name: String,
    pub creator: String,
    pub icon_url: Option<String>,
}

#[derive(Deserialize)]
struct UniverseBody {
    #[serde(default, rename = "universeId")]
    universe_id: Option<i64>,
}

#[derive(Deserialize)]
struct GamesBody {
    #[serde(default)]
    data: Vec<GameItem>,
}

#[derive(Deserialize)]
struct GameItem {
    #[serde(default)]
    name: String,
    #[serde(default)]
    creator: Option<Creator>,
}

#[derive(Deserialize)]
struct Creator {
    #[serde(default)]
    name: String,
}

/// Resolves a place id to its game. Public endpoints, no session needed — this
/// only labels what the user typed, so a failure here must never block a save.
pub fn place_info(client: &Client, place_id: u64) -> Result<PlaceInfo, String> {
    let url = format!("https://apis.roblox.com/universes/v1/places/{place_id}/universe");
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("Could not reach Roblox: {e}"))?;
    if !response.status().is_success() {
        return Err("No game is published at that place ID.".to_string());
    }
    let universe = response
        .json::<UniverseBody>()
        .map_err(|e| format!("Unexpected response from Roblox: {e}"))?
        .universe_id
        .ok_or("No game is published at that place ID.")?;

    let games_url = format!("https://games.roblox.com/v1/games?universeIds={universe}");
    let games = client
        .get(games_url)
        .send()
        .ok()
        .and_then(|r| r.json::<GamesBody>().ok())
        .and_then(|b| b.data.into_iter().next());

    let (name, creator) = match games {
        Some(game) => (
            game.name,
            game.creator.map(|c| c.name).unwrap_or_default(),
        ),
        None => (format!("Place {place_id}"), String::new()),
    };

    let icon_url = client
        .get(format!(
            "https://thumbnails.roblox.com/v1/games/icons?universeIds={universe}\
&returnPolicy=PlaceHolder&size=256x256&format=Png&isCircular=false"
        ))
        .send()
        .ok()
        .filter(|r| r.status().is_success())
        .and_then(|r| r.json::<ThumbnailBody>().ok())
        .and_then(|b| b.data.into_iter().find_map(|i| i.image_url));

    Ok(PlaceInfo {
        place_id,
        universe_id: universe,
        name,
        creator,
        icon_url,
    })
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Percent-encodes the bytes RFC 3986 does not allow in a query component.
fn pct(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 2);
    for b in input.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Deep link that opens the installed client in a place, signed in as the
/// account the ticket belongs to.
pub fn play_uri(ticket: &str, place_id: u64) -> String {
    let launcher = format!(
        "https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestGame\
&placeId={place_id}&isPlayTeleport=false&browserTrackerId={}&isMobile=false",
        now_ms()
    );
    format!(
        "roblox-player:1+launchmode:play+gameinfo:{ticket}+launchtime:{}+placelauncherurl:{}",
        now_ms(),
        pct(&launcher)
    )
}

/// Deep link that boots the client itself (the Roblox app/home), signed in.
pub fn app_uri(ticket: &str) -> String {
    format!(
        "roblox-player:1+launchmode:app+gameinfo:{ticket}+launchtime:{}",
        now_ms()
    )
}

/// Opens any URL with the default handler.
///
/// On Windows this deliberately avoids `cmd /C start`: the launcher URL is
/// percent-encoded, and cmd would expand the `%XX` sequences as variables and
/// corrupt it. `rundll32` hands the string straight to ShellExecute.
pub fn open_url(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", url]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(url);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(url);
        c
    };

    cmd.spawn()
        .map_err(|e| format!("Could not open the Roblox client: {e}"))?;
    Ok(())
}

/// Whether anything registered the `roblox-player:` protocol handler.
pub fn protocol_registered() -> bool {
    #[cfg(target_os = "windows")]
    {
        return [
            "HKCU\\Software\\Classes\\roblox-player",
            "HKLM\\Software\\Classes\\roblox-player",
        ]
        .iter()
        .any(|key| {
            Command::new("reg")
                .args(["query", key])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        });
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}
