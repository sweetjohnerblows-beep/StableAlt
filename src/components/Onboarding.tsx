import { useState } from "react";
import { LogoMark } from "./Logo";

type Props = {
  /** Returns an error to show in place of dismissing the card. */
  onChoose: (enabled: boolean) => Promise<string | null>;
};

export function Onboarding({ onChoose }: Props) {
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(enabled: boolean) {
    setBusy(enabled ? "yes" : "no");
    setError(null);
    const problem = await onChoose(enabled);
    setBusy(null);
    if (problem) setError(problem);
  }

  return (
    <div className="splash onboarding">
      <div className="splash-glow" />
      <div className="onboard-card">
        <div className="onboard-mark" aria-hidden="true">
          <LogoMark size={32} />
        </div>
        <h1>Run more than one account at once?</h1>
        <p>
          Multi-instance lets each account open its own Roblox window instead of collapsing into the
          one already open. Nothing is injected into the game — the app just holds Roblox's
          single-instance lock while it runs.
        </p>

        {error && <p className="onboard-error">{error}</p>}

        <div className="onboard-actions">
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => pick(true)}
            disabled={busy !== null}
          >
            {busy === "yes" ? <span className="spinner dark" /> : null}
            Enable multi-instance
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => pick(false)}
            disabled={busy !== null}
          >
            {busy === "no" ? <span className="spinner" /> : null}
            Not now
          </button>
        </div>

        <p className="onboard-foot">You can change this any time in Settings.</p>
      </div>
    </div>
  );
}
