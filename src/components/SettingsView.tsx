import { useState } from "react";

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
  fpsCap: number | null;
  busy: string | null;
  activePreset: string | null;
  onApplyPreset: (id: string) => void;
  accountCount: number;
  vaultPath: string;
  onToggleMultiInstance: () => void;
  onToggleLowMemory: () => void;
  onSetFpsCap: (cap: number | null) => void;
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
  fpsCap,
  busy,
  activePreset,
  onApplyPreset,
  accountCount,
  vaultPath,
  onToggleMultiInstance,
  onToggleLowMemory,
  onSetFpsCap,
  onLock,
}: Props) {
  const [copied, setCopied] = useState(false);

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

      <p className="settings-foot">
        StableAlt talks only to Roblox, with the sessions you give it. Multi-account use is still
        governed by Roblox's terms — keep it to accounts you own.
      </p>
    </div>
  );
}
