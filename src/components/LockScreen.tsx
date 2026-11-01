import { useState, type FormEvent } from "react";
import { message } from "../api";
import { LogoMark } from "./Logo";

type Props = {
  exists: boolean;
  onCreate: (password: string) => Promise<void>;
  onUnlock: (password: string) => Promise<void>;
};

export function LockScreen({ exists, onCreate, onUnlock }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    if (!exists) {
      if (password.length < 8) {
        setError("Use at least 8 characters for the master password.");
        return;
      }
      if (password !== confirm) {
        setError("The two passwords don't match.");
        return;
      }
    }

    setBusy(true);
    try {
      if (exists) {
        await onUnlock(password);
      } else {
        await onCreate(password);
      }
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lock">
      <div className="lock-shell">
        <aside className="lock-brand">
          <div className="lock-brand-head">
            <LogoMark size={42} />
            <span>
              Stable<em>Alt</em>
            </span>
          </div>

          <div className="lock-brand-body">
            <h2>
              Every alt.
              <br />
              One window.
            </h2>
            <p>
              Logins, launches and client settings for all of your accounts — stored on this PC and
              nowhere else.
            </p>

            <ul className="lock-points">
              <li>
                <strong>Side-by-side clients</strong>
                <em>Multi-instance holds Roblox's lock so windows don't collapse.</em>
              </li>
              <li>
                <strong>Sealed on disk</strong>
                <em>AES-256-GCM, with the key derived from your password.</em>
              </li>
              <li>
                <strong>Light on memory</strong>
                <em>Lowest graphics and a frame cap for every client you start.</em>
              </li>
            </ul>
          </div>

          <div className="lock-brand-foot">Not affiliated with Roblox</div>
        </aside>

        <form className="lock-card" onSubmit={submit}>
          <header className="lock-card-head">
            <span className="lock-badge">{exists ? "Welcome back" : "First run"}</span>
            <h1>{exists ? "Unlock your vault" : "Create your vault"}</h1>
            <p className="lock-sub">
              {exists
                ? "Enter your master password to open the accounts saved on this device."
                : "Pick a master password. Your accounts are encrypted with it before anything touches the disk."}
            </p>
          </header>

          <label className="field-label" htmlFor="master-password">
            Master password
          </label>
          <input
            id="master-password"
            className="field"
            type="password"
            autoFocus
            autoComplete={exists ? "current-password" : "new-password"}
            placeholder={exists ? "Your password" : "At least 8 characters"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />

          {!exists && (
            <>
              <label className="field-label" htmlFor="confirm-password">
                Confirm password
              </label>
              <input
                id="confirm-password"
                className="field"
                type="password"
                autoComplete="new-password"
                placeholder="Repeat the password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={busy}
              />
            </>
          )}

          {error && <p className="lock-error">{error}</p>}

          <button className="btn btn-primary lock-submit" type="submit" disabled={busy || !password}>
            {busy ? <span className="spinner dark" /> : null}
            {exists ? "Unlock vault" : "Create vault"}
          </button>

          <p className="lock-foot">
            {exists
              ? "Nothing leaves this device except the requests StableAlt makes to Roblox."
              : "There is no recovery. Forget the password and the vault stays shut — that's the point of the encryption."}
          </p>
        </form>
      </div>
    </div>
  );
}
