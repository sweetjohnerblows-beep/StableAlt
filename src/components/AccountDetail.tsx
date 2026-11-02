import { useEffect, useState } from "react";
import { api, message, type Account, type GameServer, type LaunchConfig } from "../api";
import { formatDate, formatRobux, parsePlaceId, timeAgo } from "../utils";
import { Avatar } from "./Avatar";

const FPS_CHOICES: (number | null)[] = [null, 30, 60, 144];

type Props = {
  account: Account;
  busy: string | null;
  protocolOk: boolean;
  onRefresh: () => void;
  onLaunch: (placeId: number | null, jobId?: string) => void;
  /** How many accounts are ticked in the list, so a server can take all of them. */
  pickedCount: number;
  onJoinMany: (placeId: number, jobId: string) => void;
  onCopyCookie: () => void;
  onOpenFriends: () => void;
  onRecookie: () => void;
  onSave: (note: string, tags: string[]) => Promise<void>;
  onSaveConfig: (config: LaunchConfig) => Promise<void>;
  onRemove: () => void;
};

function Toggle({
  on,
  label,
  disabled,
  onToggle,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={on ? "switch on" : "switch"}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="knob" />
    </button>
  );
}

function GameIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="2.5" y="6" width="19" height="12" rx="3.5" />
      <path d="M7 10.5v3M5.5 12h3M15.5 11.5h.01M18 13.5h.01" strokeLinecap="round" />
    </svg>
  );
}

export function AccountDetail({
  account,
  busy,
  protocolOk,
  onRefresh,
  onLaunch,
  pickedCount,
  onJoinMany,
  onCopyCookie,
  onOpenFriends,
  onRecookie,
  onSave,
  onSaveConfig,
  onRemove,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draftNote, setDraftNote] = useState(account.note);
  const [draftTags, setDraftTags] = useState(account.tags.join(", "));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [place, setPlace] = useState("");
  const [editingGame, setEditingGame] = useState(!account.place_id);
  const [gameError, setGameError] = useState<string | null>(null);
  const [savingGame, setSavingGame] = useState(false);
  const [savingOptions, setSavingOptions] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [serversOpen, setServersOpen] = useState(false);
  const [servers, setServers] = useState<GameServer[] | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [loadingServers, setLoadingServers] = useState(false);
  const [joiningJob, setJoiningJob] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setDraftNote(account.note);
    setDraftTags(account.tags.join(", "));
    setSaveError(null);
    setPlace("");
    setEditingGame(!account.place_id);
    setGameError(null);
    setConfirmRemove(false);
  }, [account.id]);

  useEffect(() => {
    if (!confirmRemove) return;
    const timer = window.setTimeout(() => setConfirmRemove(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmRemove]);

  const launching = busy === "launch";
  const placeId = parsePlaceId(place);

  async function save() {
    if (busy === "save") return;
    setSaveError(null);
    try {
      await onSave(draftNote.trim(), draftTags.split(",").map((t) => t.trim()).filter(Boolean));
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  /** Every option is a full config write, so nothing can drift out of sync. */
  async function saveConfig(patch: Partial<LaunchConfig>) {
    setSavingOptions(true);
    try {
      await onSaveConfig({
        placeId: account.place_id,
        placeName: account.place_name,
        placeIcon: account.place_icon,
        useGlobal: account.use_global_perf,
        lowGraphics: account.low_graphics,
        fpsCap: account.fps_cap,
        ...patch,
      });
    } finally {
      setSavingOptions(false);
    }
  }

  async function setGame() {
    const id = parsePlaceId(place);
    if (id === null) {
      setGameError("That doesn't look like a place ID or a roblox.com/games link.");
      return;
    }

    setSavingGame(true);
    setGameError(null);
    try {
      const info = await api.placeLookup(id);
      await saveConfig({
        placeId: id,
        placeName: info.name,
        placeIcon: info.icon_url,
      });
      setPlace("");
      setEditingGame(false);
    } catch (err) {
      setGameError(message(err));
    } finally {
      setSavingGame(false);
    }
  }

  async function clearGame() {
    setSavingGame(true);
    try {
      await saveConfig({ placeId: null, placeName: "", placeIcon: null });
      setEditingGame(true);
    } finally {
      setSavingGame(false);
    }
  }

  /**
   * Opens the server picker and loads the place's public servers.
   * Roblox rate-limits this endpoint, so a failure is shown in place and the
   * previous rows are kept rather than blanked out.
   */
  async function loadServers() {
    const place = account.place_id;
    if (place === null) return;
    setLoadingServers(true);
    setServerError(null);
    try {
      const list = await api.servers(place);
      // Room first, then quietest — the two reasons anyone opens this list.
      list.sort((a, b) => {
        const roomA = a.playing < a.max_players ? 0 : 1;
        const roomB = b.playing < b.max_players ? 0 : 1;
        return roomA - roomB || a.playing - b.playing;
      });
      setServers(list);
    } catch (err) {
      setServerError(message(err));
    } finally {
      setLoadingServers(false);
    }
  }

  function toggleServers() {
    const next = !serversOpen;
    setServersOpen(next);
    if (next && servers === null) void loadServers();
  }

  async function joinServer(server: GameServer) {
    if (account.place_id === null) return;
    setJoiningJob(server.job_id);
    try {
      onLaunch(account.place_id, server.job_id);
    } finally {
      // The client takes a couple of seconds to appear; the row clears as soon
      // as the launch URL has been handed to Windows.
      window.setTimeout(() => setJoiningJob(null), 1500);
    }
  }

  return (
    <section className="detail">
      <header className="detail-head">
        <Avatar name={account.display_name || account.username} url={account.avatar_url} large />
        <div className="detail-id">
          <h2>
            <span>{account.display_name || account.username}</span>
            <span className={`status-pill ${account.status}`}>
              <span className={`dot ${account.status}`} />
              {account.status === "ok"
                ? "Active"
                : account.status === "expired"
                  ? "Signed out"
                  : "Unchecked"}
            </span>
          </h2>
          <p className="detail-handle">
            @{account.username} · user id {account.user_id}
          </p>
        </div>
      </header>

      <div className="detail-actions">
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => onLaunch(null)}
          disabled={launching}
          title={
            account.place_id
              ? `Joins ${account.place_name || `place ${account.place_id}`}`
              : "Opens Roblox's home page"
          }
        >
          {launching ? <span className="spinner dark" /> : null}
          {launching ? "Opening…" : "Launch Roblox"}
        </button>
        {account.last_job && account.last_place !== null && (
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => onLaunch(account.last_place, account.last_job ?? undefined)}
            disabled={launching}
            title={`Back into the server this account was last in — ${account.last_job.slice(
              0,
              8,
            )}${account.last_job_at ? `, ${timeAgo(account.last_job_at)}` : ""}`}
          >
            Rejoin server
          </button>
        )}
        <button className="btn btn-secondary" type="button" onClick={onOpenFriends}>
          Friends
        </button>
        <button className="btn btn-secondary" type="button" onClick={onCopyCookie} disabled={busy === "copy"}>
          Copy cookie
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={onRecookie}
          title="Paste a fresh cookie without losing this account's settings"
        >
          Reconnect
        </button>
        <button className="btn btn-secondary" type="button" onClick={onRefresh} disabled={busy === "refresh"}>
          {busy === "refresh" ? <span className="spinner" /> : null}
          {busy === "refresh" ? "Checking…" : "Refresh"}
        </button>
      </div>

      {account.status === "expired" && (
        <div className="callout callout-row">
          <span>
            Roblox rejected this cookie, so launches will fail. Sign in again on roblox.com and
            paste the new one — this account keeps its game, graphics and note.
          </span>
          <button className="btn btn-secondary btn-sm" type="button" onClick={onRecookie}>
            Reconnect cookie
          </button>
        </div>
      )}

      {!protocolOk && (
        <div className="callout" style={{ marginTop: 16 }}>
          The <span className="mono">roblox-player:</span> protocol isn't registered yet, so launch
          links won't reach the client. Install or open Roblox once, then try again.
        </div>
      )}

      <div className="section">
        <div className="section-head">
          <h3>Game</h3>
          <span className="section-tag">
            {account.place_id ? "Joins on launch" : "Opens home"}
          </span>
        </div>

        {account.place_id && !editingGame ? (
          <div className="game-card">
            <span className="game-icon">
              {account.place_icon ? (
                <img src={account.place_icon} alt="" loading="lazy" />
              ) : (
                <GameIcon />
              )}
            </span>
            <span className="game-text">
              <strong>{account.place_name || `Place ${account.place_id}`}</strong>
              <span>Place {account.place_id}</span>
            </span>
            <span className="game-actions">
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => onLaunch(account.place_id)}
                disabled={launching}
              >
                Join now
              </button>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => setEditingGame(true)}
              >
                Change
              </button>
            </span>
          </div>
        ) : (
          <div className="form-grid">
            <div className="join">
              <input
                className="field"
                placeholder="Place ID or roblox.com/games/… link"
                value={place}
                onChange={(e) => {
                  setPlace(e.target.value);
                  setGameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && placeId !== null) void setGame();
                }}
                spellCheck={false}
              />
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void setGame()}
                disabled={placeId === null || savingGame}
              >
                {savingGame ? <span className="spinner dark" /> : null}
                {savingGame ? "Looking up…" : "Save game"}
              </button>
            </div>
            {gameError && <p className="field-error">{gameError}</p>}
            <div className="inline-actions">
              {account.place_id ? (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => {
                    setEditingGame(false);
                    setPlace("");
                    setGameError(null);
                  }}
                >
                  Cancel
                </button>
              ) : (
                <span className="hint">
                  Without a game, launches open Roblox's home page like a normal click.
                </span>
              )}
              {account.place_id && (
                <button
                  className="btn btn-ghost btn-sm danger-text"
                  type="button"
                  onClick={() => void clearGame()}
                  disabled={savingGame}
                >
                  Clear game
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {account.place_id && (
        <div className="section">
          <div className="section-head">
            <h3>Servers</h3>
            <div className="section-tools">
              {serversOpen && (
                <span className="section-tag">
                  {servers === null ? "…" : `${servers.length} public`}
                </span>
              )}
              {serversOpen && (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() => void loadServers()}
                  disabled={loadingServers}
                >
                  {loadingServers ? "Refreshing…" : "Refresh"}
                </button>
              )}
              <button className="btn btn-ghost btn-sm" type="button" onClick={toggleServers}>
                {serversOpen ? "Hide" : "Browse servers"}
              </button>
            </div>
          </div>

          {serversOpen && (
            <>
              <p className="hint hint-block">
                Join a specific one and this account lands in that same server — with friends, or
                with your own alts, one after another. Tick accounts in the list and the ×N button
                sends every one of them into the same server.
              </p>

              {serverError && <div className="callout">{serverError}</div>}

              {loadingServers && servers === null && (
                <div className="server-empty">
                  <span className="spinner" />
                  Asking Roblox for this place's servers…
                </div>
              )}

              {servers !== null && servers.length === 0 && !serverError && (
                <div className="server-empty">
                  No public servers right now. Roblox only lists servers it can advertise, so a
                  private or limited game shows nothing here.
                </div>
              )}

              {servers !== null && servers.length > 0 && (
                <ul className="server-list">
                  {servers.map((server) => {
                    const full = server.playing >= server.max_players;
                    const share = server.max_players
                      ? Math.min(100, Math.round((server.playing / server.max_players) * 100))
                      : 0;
                    return (
                      <li key={server.job_id} className={full ? "server-row full" : "server-row"}>
                        <span className="server-fill" style={{ width: `${share}%` }} aria-hidden="true" />
                        <span className="server-players">
                          <strong>{server.playing}</strong>
                          <span>/{server.max_players}</span>
                        </span>
                        <span className="server-meta">
                          {server.ping !== null && <span>{server.ping} ms</span>}
                          {server.fps !== null && <span>{Math.round(server.fps)} fps</span>}
                          {full && <span className="server-full-tag">Full</span>}
                        </span>
                        <span className="server-job" title={server.job_id}>
                          {server.job_id.slice(0, 8)}
                        </span>
                        {pickedCount > 1 && (
                          <button
                            className="btn btn-ghost btn-sm server-many"
                            type="button"
                            onClick={() => onJoinMany(account.place_id!, server.job_id)}
                            disabled={launching || joiningJob !== null}
                            title={`Join this server with ${pickedCount} selected account${pickedCount === 1 ? "" : "s"} — three seconds apart`}
                          >
                            ×{pickedCount}
                          </button>
                        )}
                        <button
                          className="btn btn-secondary btn-sm"
                          type="button"
                          onClick={() => void joinServer(server)}
                          disabled={launching || joiningJob !== null}
                        >
                          {joiningJob === server.job_id ? "Joining…" : full ? "Try" : "Join"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <div className="section">
        <div className="section-head">
          <h3>Launch options</h3>
          <span className="section-tag">
            {account.use_global_perf ? "App-wide" : "Custom"}
          </span>
        </div>

        <div className="option-row">
          <div className="option-text">
            <div className="option-title">Use app-wide performance</div>
            <p className="hint">
              Follow the settings in the Performance tab. Turn this off to give this account its own
              graphics and frame rate — a main account that stays sharp while alts run light.
            </p>
          </div>
          <Toggle
            on={account.use_global_perf}
            label="Use app-wide performance"
            disabled={savingOptions}
            onToggle={() => void saveConfig({ useGlobal: !account.use_global_perf })}
          />
        </div>

        {!account.use_global_perf && (
          <>
            <div className="option-row">
              <div className="option-text">
                <div className="option-title">
                  Lowest graphics
                  <span className={account.low_graphics ? "chip ok" : "chip"}>
                    {account.low_graphics ? "On" : "Off"}
                  </span>
                </div>
                <p className="hint">
                  Minimum textures, geometry, no grass, flat sky. Doesn't touch your own Roblox
                  settings, and they come back when this is off.
                </p>
              </div>
              <Toggle
                on={account.low_graphics}
                label="Lowest graphics"
                disabled={savingOptions}
                onToggle={() => void saveConfig({ lowGraphics: !account.low_graphics })}
              />
            </div>

            <div className="option-row">
              <div className="option-text">
                <div className="option-title">
                  Frame-rate cap
                  <span className={account.fps_cap ? "chip ok" : "chip"}>
                    {account.fps_cap ? `${account.fps_cap} fps` : "Off"}
                  </span>
                </div>
                <p className="hint">Written to Roblox's own cap right before this client starts.</p>
              </div>
              <div className="segmented" role="group" aria-label="Frame-rate cap">
                {FPS_CHOICES.map((choice) => (
                  <button
                    key={choice ?? "off"}
                    type="button"
                    className={account.fps_cap === choice ? "seg active" : "seg"}
                    aria-pressed={account.fps_cap === choice}
                    disabled={savingOptions}
                    onClick={() => void saveConfig({ fpsCap: choice })}
                  >
                    {choice ?? "Off"}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <dl className="stats">
        <div className="stat">
          <dt>Robux</dt>
          <dd className={account.robux === null ? "muted" : undefined}>{formatRobux(account.robux)}</dd>
        </div>
        <div className="stat">
          <dt>Session</dt>
          <dd className={account.status === "ok" ? undefined : "muted"}>
            {account.status === "ok" ? "Cookie valid" : account.status === "expired" ? "Cookie rejected" : "Not checked"}
          </dd>
        </div>
        <div className="stat">
          <dt>Last checked</dt>
          <dd className="muted">{timeAgo(account.checked_at)}</dd>
        </div>
        <div className="stat">
          <dt>Added</dt>
          <dd className="muted">{formatDate(account.added_at)}</dd>
        </div>
      </dl>

      <div className="section">
        <div className="section-head">
          <h3>Note</h3>
          {!editing && (
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => {
                setDraftNote(account.note);
                setDraftTags(account.tags.join(", "));
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <div className="form-grid">
            <textarea
              className="field"
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="What is this account for?"
              rows={3}
            />
            <div>
              <label className="field-label" htmlFor="tags-edit">
                Tags
              </label>
              <input
                id="tags-edit"
                className="field"
                value={draftTags}
                onChange={(e) => setDraftTags(e.target.value)}
                placeholder="main, trading, alt"
              />
            </div>
            {saveError && <p className="lock-error" style={{ margin: 0 }}>{saveError}</p>}
            <div className="form-actions">
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="btn btn-primary btn-sm" type="button" onClick={save} disabled={busy === "save"}>
                {busy === "save" ? <span className="spinner dark" /> : null}
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={account.note ? "note-body" : "note-body placeholder"}>
              {account.note || "No note yet."}
            </div>
            <div className="tag-row" style={{ marginTop: 10 }}>
              {account.tags.length > 0 ? (
                account.tags.map((tag) => (
                  <span className="tag" key={tag}>
                    {tag}
                  </span>
                ))
              ) : (
                <span className="tag placeholder">No tags</span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="danger-zone">
        <p>
          Removing deletes the cookie from this vault. It does not log the account out of Roblox or
          change anything on the account itself.
        </p>
        <button
          className="btn btn-danger btn-sm"
          type="button"
          onClick={() => (confirmRemove ? onRemove() : setConfirmRemove(true))}
          disabled={busy === "remove"}
        >
          {busy === "remove" ? <span className="spinner" /> : null}
          {confirmRemove ? "Confirm remove" : "Remove"}
        </button>
      </div>
    </section>
  );
}
