import { useEffect } from "react";

export type QueueItem = {
  id: string;
  name: string;
  state: "pending" | "launching" | "done" | "failed";
  error?: string;
};

type Props = {
  items: QueueItem[];
  /** The server every launch in this run is pinned to, when there is one. */
  target?: string | null;
  running: boolean;
  multiInstance: boolean;
  onStop: () => void;
  onClose: () => void;
};

const LABEL: Record<QueueItem["state"], string> = {
  pending: "Queued",
  launching: "Opening…",
  done: "Launched",
  failed: "Failed",
};

export function BatchLaunchDialog({ items, target, running, multiInstance, onStop, onClose }: Props) {
  const done = items.filter((i) => i.state === "done").length;
  const failed = items.filter((i) => i.state === "failed").length;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !running) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, onClose]);

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !running) onClose();
      }}
    >
      <div className="modal batch-modal" role="dialog" aria-modal="true" aria-labelledby="batch-title">
        <div className="modal-head">
          <div>
            <h2 id="batch-title">Launching {items.length} accounts</h2>
            <p>
              {running
                ? "Three seconds apart, so Roblox doesn't rate-limit the tickets."
                : `${done} launched${failed > 0 ? ` · ${failed} failed` : ""}.`}
            </p>
            {target && <p className="batch-target">All into {target}</p>}
          </div>
          <button className="icon-btn" type="button" onClick={onClose} disabled={running} aria-label="Close">
            ✕
          </button>
        </div>

        {!multiInstance && (
          <p className="batch-warn">
            Multi-instance is off, so Windows will keep focusing one window. Turn it on in Settings for
            this to open separate clients.
          </p>
        )}

        <div className="batch-list">
          {items.map((item) => (
            <div className={`batch-row ${item.state}`} key={item.id}>
              <span className={`batch-state ${item.state}`} />
              <span className="batch-name">{item.name}</span>
              <span className="batch-label">{item.error ?? LABEL[item.state]}</span>
            </div>
          ))}
        </div>

        <div className="batch-foot">
          {running ? (
            <button className="btn btn-secondary" type="button" onClick={onStop}>
              Stop after this one
            </button>
          ) : (
            <button className="btn btn-primary" type="button" onClick={onClose}>
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
