import { useState } from "react";
import { open as openFile, save as saveFile } from "@tauri-apps/plugin-dialog";
import { api, message, type Account } from "../api";
import type { Theme } from "../themes";
import { ThemeStudio } from "./ThemeStudio";

const FPS_CHOICES: (number | null)[] = [null, 30, 60, 144];

const PRESETS = [
  { id: "max", name: "Max alts", detail: "Lowest graphics · 30 FPS" },
  { id: "balanced", name: "Balanced", detail: "Lowest graphics · 60 FPS" },
  { id: "defaults", name: "Roblox defaults", detail: "Your own settings · no cap" },
];

type Props = {
  multiInstance: boolean;
  lowMemory: boolean;
  monitorSessions: boolean;
  onToggleMonitor: () => void;
  antiAfk: boolean;
  onToggleAntiAfk: () => void;
  autoRejoin: boolean;
  onToggleAutoRejoin: () => void;
  closeToTray: boolean;
  onToggleCloseToTray: () => void;
  fpsCap: number | null;
  theme: Theme;
  customThemes: Theme[];
  onChooseTheme: (theme: Theme) => void;
  onSaveTheme: (theme: Theme) => void;
  onDeleteTheme: (id: string) => void;
  busy: string | null;
  activePreset: string | null;
  onApplyPreset: (id: string) => void;
  accountCount: number;
  vaultPath: string;
  onToggleMultiInstance: () => void;
  onToggleLowMemory: () => void;
  onSetFpsCap: (cap: number | null) => void;
  onRestored: (accounts: Account[]) => void;
  onLock: () => void;
};

function Switch({
  on,
  disabled,
  label,
  onToggle,
}: {
  on: boolean;
  disabled: boolean;
  label: string;
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

export function SettingsView({
  multiInstance,
  lowMemory,
  monitorSessions,
  onToggleMonitor,
  antiAfk,
  onToggleAntiAfk,
  autoRejoin,
  onToggleAutoRejoin,
  closeToTray,
  onToggleCloseToTray,
  fpsCap,
  theme,
  customThemes,
  onChooseTheme,
  onSaveTheme,
  onDeleteTheme,
  busy,
  activePreset,
  onApplyPreset,
  accountCount,
  vaultPath,
  onToggleMultiInstance,
  onToggleLowMemory,
  onSetFpsCap,
  onRestored,
  onLock,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [backupBusy, setBackupBusy] = useState<"save" | "restore" | null>(null);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [pendingBackup, setPendingBackup] = useState<string | null>(null);
  const [backupPassword, setBackupPassword] = useState("");

  async function saveBackup() {
    if (backupBusy) return;
    setBackupError(null);
    setBackupNote(null);
    try {
      const day = new Date().toISOString().slice(0, 10);
      const picked = await saveFile({
        title: "Save a StableAlt backup",
        defaultPath: `StableAlt-backup-${day}.savault`,
        filters: [{ name: "StableAlt backup", extensions: ["savault"] }],
      });
      if (!picked) return;
      setBackupBusy("save");
      const result = await api.backupExport(picked);
      setSavedPath(result.path);
      setBackupNote(
        `Saved ${result.accounts} account${result.accounts === 1 ? "" : "s"} — readable only with your master password.`,
      );
    } catch (err) {
      setBackupError(message(err));
    } finally {
      setBackupBusy(null);
    }
  }

  async function restoreBackup(path: string, password: string | null) {
    setBackupBusy("restore");
    try {
      const result = await api.backupImport(path, password);
      if (result.needs_password) {
        setPendingBackup(path);
        setBackupNote(null);
        setBackupError(null);
        return;
      }
      setPendingBackup(null);
      setBackupPassword("");
      onRestored(result.accounts);
      setBackupNote(
        result.added === 0
          ? "Nothing new — every account in that backup is already here."
          : `${result.added} account${result.added === 1 ? "" : "s"} added${
              result.skipped > 0 ? `, ${result.skipped} already here` : ""
            }.`,
      );
    } catch (err) {
      setBackupError(message(err));
    } finally {
      setBackupBusy(null);
    }
  }

  async function pickBackup() {
    if (backupBusy) return;
    setBackupError(null);
    setBackupNote(null);
    setPendingBackup(null);
    setBackupPassword("");
    try {
      const picked = await openFile({
        title: "Choose a StableAlt backup",
        multiple: false,
        directory: false,
        filters: [{ name: "StableAlt backup", extensions: ["savault", "json"] }],
      });
      if (!picked || Array.isArray(picked)) return;
      await restoreBackup(picked, null);
    } catch (err) {
      setBackupError(message(err));
    }
  }

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(vaultPath);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* nothing useful to say; the path is visible on screen */
    }
  }

  return (
    <div className="settings">
      <ThemeStudio
        theme={theme}
        customThemes={customThemes}
        onChooseTheme={onChooseTheme}
        onSaveTheme={onSaveTheme}
        onDeleteTheme={onDeleteTheme}
      />

      <section className="settings-card">
        <header className="settings-head">
          <h2>Performance</h2>
          <p>One click sets how every client you launch renders. Change anything below afterwards.</p>
        </header>

        <div className="presets" role="group" aria-label="Performance presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={activePreset === preset.id ? "preset active" : "preset"}
              aria-pressed={activePreset === preset.id}
              disabled={busy === "preset"}
              onClick={() => onApplyPreset(preset.id)}
            >
              <strong>{preset.name}</strong>
              <span>{preset.detail}</span>
              {activePreset === preset.id && <em>In use</em>}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-card">
        <header className="settings-head">
          <h2>Clients</h2>
          <p>What every Roblox client started from here looks like.</p>
        </header>

        <div className="setting">
          <div className="setting-text">
            <div className="setting-title">
              Lowest graphics
              <span className={lowMemory ? "chip ok" : "chip"}>{lowMemory ? "On" : "Off"}</span>
            </div>
            <p>
              Alts start at the lowest texture quality, lowest render quality, lowest geometry
              detail, no MSAA, no grass and a flat sky — the settings that keep a client's memory
              down. Your own Roblox settings are untouched, and the original flag file is put back
              when you turn this off or quit.
            </p>
          </div>
          <Switch
            on={lowMemory}
            disabled={busy === "lowmem"}
            label="Lowest graphics"
            onToggle={onToggleLowMemory}
          />
        </div>

        <div className="setting">
          <div className="setting-text">
            <div className="setting-title">
              Frame-rate cap
              <span className={fpsCap ? "chip ok" : "chip"}>
                {fpsCap ? `${fpsCap} fps` : "Off"}
              </span>
            </div>
            <p>
              Sets Roblox's own Maximum Frame Rate before each client starts — lower frames mean
              less CPU and a little less memory per client. Your previous value comes back when you
              quit.
            </p>
          </div>
          <div className="segmented" role="group" aria-label="Frame-rate cap">
            {FPS_CHOICES.map((choice) => (
              <button
                key={choice ?? "off"}
                type="button"
                className={fpsCap === choice ? "seg active" : "seg"}
                aria-pressed={fpsCap === choice}
                disabled={busy === "fps"}
                onClick={() => onSetFpsCap(choice)}
              >
                {choice ?? "Off"}
              </button>
            ))}
          </div>
        </div>

        <div className="setting">
          <div className="setting-text">
            <div className="setting-title">
              Multi-instance
              <span className={multiInstance ? "chip ok" : "chip"}>{multiInstance ? "On" : "Off"}</span>
            </div>
            <p>
              Lets several clients run at once instead of Windows collapsing them into one. It
              holds Roblox's singleton lock, so nothing is injected and no account is touched.
            </p>
            {!multiInstance && (
              <p className="setting-warn">
                A Roblox client is already running, so it owns the lock. Close every Roblox window —
                including stragglers in Task Manager — then switch this on.
              </p>
            )}
          </div>
          <Switch
            on={multiInstance}
            disabled={busy === "multi"}
            label="Multi-instance"
            onToggle={onToggleMultiInstance}
          />
        </div>
        <div className="setting">
          <div className="setting-text">
            <div className="setting-title">
              Session monitor
              <span className={monitorSessions ? "chip ok" : "chip"}>
                {monitorSessions ? "On" : "Off"}
              </span>
            </div>
            <p>
              Checks every saved account every five minutes with one request each, so a dead cookie
              shows up as expired before you try to launch it. If Roblox can't be reached an account
              is left alone rather than marked expired.
            </p>
          </div>
          <Switch
            on={monitorSessions}
            disabled={busy === "monitor"}
            label="Session monitor"
            onToggle={onToggleMonitor}
          />
        </div>

        <div className="setting">
          <div className="setting-text">
            <div className="setting-title">
              Anti-AFK
              <span className={antiAfk ? "chip ok" : "chip"}>{antiAfk ? "On" : "Off"}</span>
            </div>
            <p>
              Sends a Tab press to every open Roblox window every two minutes, so clients sitting
              in a server don't get dropped for being idle. It's a window message, not an injected
              script, and Tab only opens the player list — nothing in your character moves.
            </p>
            {antiAfk && (
              <p className="setting-note">
                Off by default. Some experiences ignore synthetic key presses, so treat this as
                insurance rather than a promise.
              </p>
            )}
          </div>
          <Switch
            on={antiAfk}
            disabled={busy === "afk"}
            label="Anti-AFK"
            onToggle={onToggleAntiAfk}
          />
        </div>

        <div className="setting">
          <div className="setting-text">
            <div className="setting-title">
              Auto-rejoin
              <span className={autoRejoin ? "chip ok" : "chip"}>
                {autoRejoin ? "On" : "Off"}
              </span>
            </div>
            <p>
              A client you launched from here is watched. If its window closes — a crash, a
              disconnect, or an accidental close — it opens again in the same game, with the same
              ticket, graphics and frame cap as the first launch. After three failed attempts it
              stops rather than looping.
            </p>
            {!autoRejoin && (
              <p className="setting-note">
                Only while the vault is unlocked: a launched client needs its cookie.
              </p>
            )}
          </div>
          <Switch
            on={autoRejoin}
            disabled={busy === "rejoin"}
            label="Auto-rejoin"
            onToggle={onToggleAutoRejoin}
          />
        </div>

        <div className="setting">
          <div className="setting-text">
            <div className="setting-title">
              Keep running in the tray
              <span className={closeToTray ? "chip ok" : "chip"}>
                {closeToTray ? "On" : "Off"}
              </span>
            </div>
            <p>
              Closing the window hides it to the notification area instead of quitting, so anti-AFK,
              auto-rejoin and the session check keep working with nothing on screen. The tray menu
              opens it again, toggles anti-AFK, or quits properly.
            </p>
            {!closeToTray && (
              <p className="setting-note">
                With this off, closing the window quits and every background job stops with it.
              </p>
            )}
          </div>
          <Switch
            on={closeToTray}
            disabled={busy === "tray"}
            label="Keep running in the tray"
            onToggle={onToggleCloseToTray}
          />
        </div>
      </section>

      <section className="settings-card">
        <header className="settings-head">
          <h2>Vault</h2>
          <p>Everything is stored locally, encrypted with your master password.</p>
        </header>

        <dl className="kv">
          <div>
            <dt>Accounts</dt>
            <dd>{accountCount}</dd>
          </div>
          <div>
            <dt>Encryption</dt>
            <dd>Argon2id + AES-256-GCM</dd>
          </div>
        </dl>

        <div className="setting">
          <div className="setting-text">
            <div className="setting-title">Vault file</div>
            <p className="mono path">{vaultPath || "No vault on this device yet."}</p>
          </div>
          <div className="setting-actions">
            <button className="btn btn-secondary btn-sm" type="button" onClick={copyPath} disabled={!vaultPath}>
              {copied ? "Copied" : "Copy path"}
            </button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={onLock}>
              Lock
            </button>
          </div>
        </div>
      </section>

      <section className="settings-card">
        <header className="settings-head">
          <h2>Backup</h2>
          <p>
            One encrypted file with every account, its game and its options. It only opens with
            the master password that made it — keep a copy somewhere that isn't this PC.
          </p>
        </header>

        <div className="setting">
          <div className="setting-text">
            <div className="setting-title">Save a backup</div>
            <p>
              Writes the same encrypted envelope the vault uses, so a copy on a USB stick is as
              safe as the vault itself.
            </p>
            {savedPath && backupNote && (
              <p className="mono path" style={{ marginTop: 8 }}>
                {savedPath}
              </p>
            )}
          </div>
          <div className="setting-actions">
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => void saveBackup()}
              disabled={backupBusy !== null || accountCount === 0}
            >
              {backupBusy === "save" ? <span className="spinner" /> : null}
              {backupBusy === "save" ? "Saving…" : "Save backup…"}
            </button>
          </div>
        </div>

        <div className="setting">
          <div className="setting-text">
            <div className="setting-title">Restore a backup</div>
            <p>
              Adds the accounts from a backup into this vault. Anything already here is left alone,
              so restoring the same file twice does nothing the second time.
            </p>
            {pendingBackup && (
              <div style={{ marginTop: 12, maxWidth: 340 }}>
                <label className="field-label" htmlFor="backup-password">
                  That backup's master password
                </label>
                <input
                  id="backup-password"
                  className="field"
                  type="password"
                  autoFocus
                  value={backupPassword}
                  onChange={(event) => setBackupPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && backupPassword) {
                      void restoreBackup(pendingBackup, backupPassword);
                    }
                  }}
                  disabled={backupBusy !== null}
                />
                <p className="hint">It was made on another PC, so it has its own password.</p>
              </div>
            )}
          </div>
          <div className="setting-actions">
            {pendingBackup ? (
              <button
                className="btn btn-primary btn-sm"
                type="button"
                onClick={() => void restoreBackup(pendingBackup, backupPassword)}
                disabled={backupBusy !== null || !backupPassword}
              >
                {backupBusy === "restore" ? <span className="spinner dark" /> : null}
                Restore
              </button>
            ) : (
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => void pickBackup()}
                disabled={backupBusy !== null}
              >
                {backupBusy === "restore" ? <span className="spinner" /> : null}
                {backupBusy === "restore" ? "Restoring…" : "Restore…"}
              </button>
            )}
          </div>
        </div>

        {backupNote && !backupError && <p className="setting-note">{backupNote}</p>}
        {backupError && <p className="lock-error">{backupError}</p>}
      </section>

      <p className="settings-foot">
        StableAlt talks only to Roblox, with the sessions you give it. Multi-account use is still
        governed by Roblox's terms — keep it to accounts you own.
      </p>
    </div>
  );
}
