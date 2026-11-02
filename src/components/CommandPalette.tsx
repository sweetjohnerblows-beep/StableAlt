import { useEffect, useMemo, useRef, useState } from "react";
import type { Account } from "../api";

type Item =
  | { kind: "launch"; key: string; account: Account }
  | { kind: "view"; key: string; view: "accounts" | "monitor" | "settings"; label: string };

type Props = {
  open: boolean;
  accounts: Account[];
  busy: boolean;
  onClose: () => void;
  onLaunch: (id: string) => void;
  onSelect: (id: string) => void;
  onView: (view: "accounts" | "monitor" | "settings") => void;
};

const VIEWS: { view: "accounts" | "monitor" | "settings"; label: string }[] = [
  { view: "accounts", label: "Go to Accounts" },
  { view: "monitor", label: "Go to Clients" },
  { view: "settings", label: "Go to Settings" },
];

/**
 * Ctrl/Cmd+K: type a name and hit Enter to put that alt in game.
 *
 * The account list is the place to browse; this is the keyboard path for
 * someone who already knows which account they want.
 */
export function CommandPalette({ open, accounts, busy, onClose, onLaunch, onSelect, onView }: Props) {
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setTerm("");
    setActive(0);
    // The overlay mounts with the palette, so focus lands on the field.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 10);
    return () => window.clearTimeout(timer);
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const needle = term.trim().toLowerCase();
    const matches = (account: Account) =>
      !needle ||
      [account.username, account.display_name, account.note, ...account.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle);

    const out: Item[] = accounts.filter(matches).map((account) => ({
      kind: "launch",
      key: `launch-${account.id}`,
      account,
    }));

    for (const entry of VIEWS) {
      if (needle && !entry.label.toLowerCase().includes(needle)) continue;
      out.push({ kind: "view", key: `view-${entry.view}`, view: entry.view, label: entry.label });
    }

    return out.slice(0, 9);
  }, [accounts, term]);

  useEffect(() => {
    setActive((current) => (current >= items.length ? 0 : current));
  }, [items.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  function run(item: Item) {
    if (item.kind === "launch") onLaunch(item.account.id);
    else onView(item.view);
  }

  return (
    <div className="overlay palette-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Quick launch">
        <div className="palette-input">
          <input
            ref={inputRef}
            value={term}
            spellCheck={false}
            placeholder="Type a name to launch, or a section…"
            aria-label="Search accounts to launch"
            onChange={(event) => {
              setTerm(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((current) => (items.length === 0 ? 0 : (current + 1) % items.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((current) => (items.length === 0 ? 0 : (current - 1 + items.length) % items.length));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const item = items[active];
                if (item) run(item);
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="palette-list" ref={listRef} role="listbox" aria-label="Quick launch results">
          {items.map((item, index) =>
            item.kind === "launch" ? (
              <div
                key={item.key}
                role="option"
                aria-selected={index === active}
                data-index={index}
                className={index === active ? "palette-row active" : "palette-row"}
                onMouseEnter={() => setActive(index)}
                onClick={() => !busy && run(item)}
              >
                <span className="palette-name">
                  {item.account.display_name || item.account.username}
                  <em>@{item.account.username}</em>
                </span>
                <span className="palette-hint">
                  {item.account.place_name || "Roblox home"}
                  {item.account.status === "expired" && <b>expired</b>}
                </span>
                <button
                  type="button"
                  className="palette-act"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(item.account.id);
                  }}
                  title="Open this account instead of launching"
                >
                  Open
                </button>
              </div>
            ) : (
              <div
                key={item.key}
                role="option"
                aria-selected={index === active}
                data-index={index}
                className={index === active ? "palette-row nav active" : "palette-row nav"}
                onMouseEnter={() => setActive(index)}
                onClick={() => run(item)}
              >
                <span className="palette-name">{item.label}</span>
              </div>
            ),
          )}

          {items.length === 0 && <div className="palette-empty">No account matches that.</div>}
        </div>

        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>Enter</kbd> launch
          </span>
          <span>
            <kbd>Ctrl</kbd>
            <kbd>K</kbd> anywhere
          </span>
        </div>
      </div>
    </div>
  );
}
