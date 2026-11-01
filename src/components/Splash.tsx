import { LogoMark } from "./Logo";

export function Splash() {
  return (
    <div className="splash">
      <div className="splash-inner">
        <div className="splash-mark">
          <LogoMark size={88} />
        </div>

        <h1 className="splash-word">
          Stable<span>Alt</span>
        </h1>
        <p className="splash-kicker">Account manager</p>

        <div className="splash-bar">
          <span />
        </div>
        <p className="splash-status">Opening your vault</p>
      </div>

      <footer className="splash-foot">
        <span>StableAlt 1.0.0</span>
        <span>Encrypted on this device</span>
      </footer>
    </div>
  );
}
