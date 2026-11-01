import { useEffect, useState } from "react";
import { message } from "../api";

type Props = {
  accountName: string;
  onReplace: (cookie: string) => Promise<void>;
  onClose: () => void;
};

export function RecookieDialog({ accountName, onReplace, onClose }: Props) {
  const [cookie, setCookie] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit() {
    if (busy) return;
    if (!cookie.trim()) {
      setError("Paste the new .ROBLOSECURITY cookie first.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onReplace(cookie);
      onClose();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="recookie-title">
        <div className="modal-head">
          <div>
            <h2 id="recookie-title">Reconnect {accountName}</h2>
            <p>
              The game, graphics options, note and tags stay as they are — only the cookie is
              replaced.
            </p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="form-grid">
          <div>
            <label className="field-label" htmlFor="recookie">
              New .ROBLOSECURITY cookie
            </label>
            <textarea
              id="recookie"
              className="field mono"
              autoFocus
              spellCheck={false}
              placeholder="_|WARNING:-DO-NOT-SHARE…"
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit();
              }}
              disabled={busy}
              rows={4}
            />
            <p className="hint">
              Sign in to this account again on roblox.com, then copy the cookie from DevTools →
              Application → Cookies. It has to be the same account.
            </p>
          </div>

          {error && (
            <p className="lock-error" style={{ margin: 0 }}>
              {error}
            </p>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner dark" /> : null}
            {busy ? "Checking…" : "Reconnect"}
          </button>
        </div>
      </div>
    </div>
  );
}
