import { useEffect, useState } from "react";
import { message } from "../api";
import { parseTags } from "../utils";

type Props = {
  onAdd: (cookie: string, note: string, tags: string[]) => Promise<void>;
  onBulkMode: () => void;
  onClose: () => void;
};

export function AddAccountDialog({ onAdd, onBulkMode, onClose }: Props) {
  const [cookie, setCookie] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
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
      setError("Paste the .ROBLOSECURITY cookie first.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onAdd(cookie, note.trim(), parseTags(tags));
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
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <div className="modal-head">
          <div>
            <h2 id="add-title">Add an account</h2>
            <p>Paste a cookie from a browser session that's already signed in.</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="form-grid">
          <div>
            <label className="field-label" htmlFor="cookie">
              .ROBLOSECURITY cookie
            </label>
            <textarea
              id="cookie"
              className="field mono"
              autoFocus
              spellCheck={false}
              placeholder="_|WARNING:-DO-NOT-SHARE…"
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              disabled={busy}
              rows={4}
            />
            <p className="hint">
              DevTools → Application → Cookies → roblox.com → copy the
              <code className="mono"> .ROBLOSECURITY </code> value. The cookie is the login itself,
              so only paste your own.
            </p>
          </div>

          <div>
            <label className="field-label" htmlFor="note">
              Note <span style={{ textTransform: "none", letterSpacing: 0 }}>(optional)</span>
            </label>
            <input
              id="note"
              className="field"
              placeholder="e.g. main, 2019 transfer, group holder"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="tags">
              Tags <span style={{ textTransform: "none", letterSpacing: 0 }}>(comma separated)</span>
            </label>
            <input
              id="tags"
              className="field"
              placeholder="main, trading, alt"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              disabled={busy}
            />
          </div>

          {error && <p className="lock-error" style={{ margin: 0 }}>{error}</p>}

          <div className="callout">
            Roblox may invalidate a cookie when you sign out, change the password, or log in
            from a new place. Use Refresh to see which sessions are still alive.
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn btn-ghost bulk-link" type="button" onClick={onBulkMode} disabled={busy}>
            Paste a list instead
          </button>
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" onClick={submit} disabled={busy}>
            {busy ? <span className="spinner dark" /> : null}
            {busy ? "Checking…" : "Add account"}
          </button>
        </div>
      </div>
    </div>
  );
}
