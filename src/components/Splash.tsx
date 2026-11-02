import { useEffect, useState } from "react";
import { LogoMark } from "./Logo";

/**
 * Start-up splash. Plays once, holds while the app mounts, then fades out.
 *
 * The look: the mark lands with a short RGB offset that settles, the wordmark rises
 * into place, a hairline progress bar fills, and the whole layer dissolves. No window
 * resizing is involved — the app window is already open behind it, so this can never
 * leave the user with a half-sized window if the timing goes wrong.
 */

const SETTLE_MS = 1900;
const HOLD_MS = 700;
const OUT_MS = 620;

type Phase = "play" | "out" | "gone";

export function Splash() {
  const [phase, setPhase] = useState<Phase>("play");

  useEffect(() => {
    if (phase !== "play") return;
    const leave = window.setTimeout(() => setPhase("out"), SETTLE_MS + HOLD_MS);
    return () => window.clearTimeout(leave);
  }, [phase]);

  useEffect(() => {
    if (phase !== "out") return;
    const done = window.setTimeout(() => setPhase("gone"), OUT_MS);
    return () => window.clearTimeout(done);
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      className={phase === "out" ? "splash out" : "splash"}
      aria-hidden="true"
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && phase === "out") setPhase("gone");
      }}
    >
      <div className="splash-glow" />

      <div className="splash-stage">
        <div className="splash-mark">
          <span className="splash-ghost ghost-a">
            <LogoMark size={56} />
          </span>
          <span className="splash-ghost ghost-b">
            <LogoMark size={56} />
          </span>
          <span className="splash-solid">
            <LogoMark size={56} />
          </span>
        </div>

        <h1 className="splash-word">
          Stable<span>Alt</span>
        </h1>
        <p className="splash-kicker">Every alt. One window.</p>

        <div className="splash-bar">
          <span />
        </div>
      </div>

      <div className="splash-foot">
        <span className="splash-dot" />
        <span>Encrypted on this device</span>
      </div>
    </div>
  );
}
