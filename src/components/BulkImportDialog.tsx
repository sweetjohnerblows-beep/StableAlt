import { useEffect, useMemo, useState } from "react";
import { message, type BulkResult, type BulkRow } from "../api";
import { parseTags } from "../utils";

type Props = {
  onImport: (cookies: string, note: string, tags: string[]) => Promise<BulkResult>;
  onClose: () => void;
};

/** A cookie holds no whitespace or commas, so both are safe separators. */
function parseCookies(text: string): string[] {
  return text.split(/[\s,]+/).filter(Boolean);
}

export function BulkImportDialog({ onImport, onClose }: Props) {
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const found = useMemo(() => parseCookies(text).length, [text]);
  const added = rows?.filter((r) => r.outcome === "added").length ?? 0;
  const duplicates = rows?.filter((r) => r.outcome === "duplicate").length ?? 0;
  const failed = rows?.filter((r) => r.outcome === "failed").length ?? 0;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function run() {
    if (busy || found === 0) return;
    setError(null);
    setBusy(true);
    try {
      const result = await onImport(text, note.trim(), parseTags(tags));
      setRows(result.rows);
      setText("");
    } catch (err) {
      setError(message(err));
    } finally {
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
      <div className="modal bulk-modal" role="dialog" aria-modal="true" aria-labelledby="bulk-title">
        <div className="modal-head">
          <div>
            <h2 id="bulk-title">Import accounts</h2>
            <p>Paste one cookie per line. Anything already in the vault is skipped.</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} disabled={busy} aria-label="Close">
            ✕
          </button>
        </div>

        {rows === null ? (
          <>
            <label className="field-label" htmlFor="bulk-cookies">
              .ROBLOSECURITY cookies
            </label>
            <textarea
              id="bulk-cookies"
              className="field mono"
              autoFocus
              spellCheck={false}
              rows={8}
              placeholder={"_|WARNING:-DO-NOT-SHARE…\n_|WARNING:-DO-NOT-SHARE…"}
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={busy}
            />

            <p className="hint">
              {found === 0
                ? "Nothing pasted yet. Lines, spaces and commas all work as separators."
                : `${found} cookie${found === 1 ? "" : "s"} detected — each one is checked with Roblox before it's saved.`}
            </p>

            <div className="bulk-fields">
              <div>
                <label className="field-label" htmlFor="bulk-note">
                  Note <span style={{ textTransform: "none", letterSpacing: 0 }}>(optional)</span>
                </label>
                <input
                  id="bulk-note"
                  className="field"
                  placeholder="applies to every imported account"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  disabled={busy}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="bulk-tags">
                  Tags <span style={{ textTransform: "none", letterSpacing: 0 }}>(optional)</span>
                </label>
                <input
                  id="bulk-tags"
                  className="field"
                  placeholder="alts, batch1"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  disabled={busy}
                />
              </div>
            </div>

            {error && <p className="lock-error">{error}</p>}

            <div className="modal-foot">
              <button className="btn btn-secondary" type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" onClick={() => void run()} disabled={busy || found === 0}>
                {busy ? <span className="spinner dark" /> : null}
                {busy ? `Checking ${found}…` : `Import ${found || ""}`.trim()}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="bulk-summary">
              <strong>{added}</strong> added
              {duplicates > 0 && <span> · {duplicates} already in the vault</span>}
              {failed > 0 && <span className="bulk-bad"> · {failed} failed</span>}
            </p>

            <div className="bulk-rows">
              {rows.map((row, index) => (
                <div className={`batch-row ${row.outcome}`} key={`${row.label}-${index}`}>
                  <span className={`batch-state ${row.outcome === "added" ? "done" : row.outcome === "failed" ? "failed" : "pending"}`} />
                  <span className="batch-name">
                    {row.username ? `@${row.username}` : <span className="mono">{row.label}</span>}
                  </span>
                  <span className="batch-label">
                    {row.outcome === "added"
                      ? "Added"
                      : row.outcome === "duplicate"
                        ? "Already in vault"
                        : (row.error ?? "Failed")}
                  </span>
                </div>
              ))}
            </div>

            <div className="modal-foot">
              <button className="btn btn-secondary" type="button" onClick={() => setRows(null)}>
                Import another batch
              </button>
              <button className="btn btn-primary" type="button" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
