import { useEffect, useRef, useState } from "react";
import type { Account } from "../api";
import { statusLabel, timeAgo } from "../utils";
import { Avatar } from "./Avatar";

export type StatusFilter = "all" | "ok" | "expired" | "unknown";

/**
 * The orders the list offers. `attention` is the triage one: the accounts that
 * need a fresh cookie come first, so a dead session is not buried in the A's.
 */
export const SORTS = [
  { id: "name", label: "Name", hint: "A–Z" },
  { id: "launch", label: "Recent", hint: "last launch" },
  { id: "balance", label: "Balance", hint: "high first" },
  { id: "attention", label: "Attention", hint: "sign-outs" },
] as const;

export type SortKey = (typeof SORTS)[number]["id"];

type Props = {
  accounts: Account[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  picked: Set<string>;
  onTogglePick: (id: string) => void;
  onPickAll: () => void;
  tags: { tag: string; count: number }[];
  filterTag: string | null;
  onFilterTag: (tag: string | null) => void;
  stateFilter: StatusFilter;
  onStateFilter: (filter: StatusFilter) => void;
  statusCounts: Record<StatusFilter, number>;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
  pinned: Set<string>;
  onTogglePin: (id: string) => void;
};

const STATES: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ok", label: "Signed in" },
  { id: "expired", label: "Expired" },
];

export function AccountList({
  accounts,
  total,
  selectedId,
  onSelect,
  picked,
  onTogglePick,
  onPickAll,
  tags,
  filterTag,
  onFilterTag,
  stateFilter,
  onStateFilter,
  statusCounts,
  sortKey,
  onSort,
  pinned,
  onTogglePin,
}: Props) {
  const allPicked = accounts.length > 0 && accounts.every((a) => picked.has(a.id));
  const filtered = filterTag !== null || stateFilter !== "all";
  const [menuOpen, setMenuOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const current = SORTS.find((entry) => entry.id === sortKey) ?? SORTS[0];

  // A menu that is open closes on the next click anywhere else, or on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (event: PointerEvent) => {
      if (!sortRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <aside className="list-pane">
      <div className="list-head">
        <span>{filtered ? "Filtered" : "All accounts"}</span>
        <div className="list-head-right">
          {accounts.length > 0 && (
            <button className="pick-all" type="button" onClick={onPickAll}>
              {allPicked ? "Clear" : "Select all"}
            </button>
          )}
          <span className="list-count">
            {accounts.length === total ? total : `${accounts.length} / ${total}`}
          </span>
        </div>
      </div>

      <div className="list-filters">
        <div className="filter-row" role="group" aria-label="Filter by state">
          {STATES.map((state) => (
            <button
              key={state.id}
              type="button"
              className={stateFilter === state.id ? "filter-chip active" : "filter-chip"}
              aria-pressed={stateFilter === state.id}
              onClick={() => onStateFilter(state.id)}
              disabled={state.id !== "all" && statusCounts[state.id] === 0}
            >
              {state.label}
              <span>{statusCounts[state.id]}</span>
            </button>
          ))}

          <div className="sort-wrap" ref={sortRef}>
            <button
              type="button"
              className="filter-chip sort-chip"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              title={`Sort by ${current.label.toLowerCase()}`}
            >
              <SortIcon />
              {current.label}
              <CaretIcon />
            </button>

            {menuOpen && (
              <div className="sort-pop" role="listbox" aria-label="Sort accounts">
                {SORTS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="option"
                    aria-selected={entry.id === sortKey}
                    className={entry.id === sortKey ? "sort-opt on" : "sort-opt"}
                    onClick={() => {
                      onSort(entry.id);
                      setMenuOpen(false);
                    }}
                  >
                    <span className="sort-mark" aria-hidden="true">
                      {entry.id === sortKey ? "✓" : ""}
                    </span>
                    {entry.label}
                    <small>{entry.hint}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {tags.length > 0 && (
          <div className="filter-row tags" role="group" aria-label="Filter by tag">
            {filterTag !== null && (
              <button
                type="button"
                className="filter-chip active"
                onClick={() => onFilterTag(null)}
                aria-label="Clear the tag filter"
              >
                ✕ {filterTag}
              </button>
            )}
            {filterTag === null &&
              tags.slice(0, 8).map(({ tag, count }) => (
                <button
                  key={tag}
                  type="button"
                  className="filter-chip"
                  onClick={() => onFilterTag(tag)}
                  title={`Show only #${tag}`}
                >
                  #{tag}
                  <span>{count}</span>
                </button>
              ))}
          </div>
        )}
      </div>

      <div className="list-scroll">
        {accounts.map((account) => {
          const isPicked = picked.has(account.id);
          const isPinned = pinned.has(account.id);
          return (
            <div
              key={account.id}
              role="button"
              tabIndex={0}
              className={[
                "account",
                account.id === selectedId ? "active" : "",
                isPicked ? "picked" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={account.id === selectedId}
              onClick={() => onSelect(account.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(account.id);
                }
              }}
            >
              <label
                className="pick"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={isPicked}
                  aria-label={`Select @${account.username}`}
                  onChange={() => onTogglePick(account.id)}
                />
              </label>

              <Avatar name={account.display_name || account.username} url={account.avatar_url} />

              <span className="account-meta">
                <span className="account-name">{account.display_name || account.username}</span>
                <span className="account-sub">
                  @{account.username}
                  {account.robux !== null && <span>· R$ {account.robux.toLocaleString()}</span>}
                </span>
              </span>

              <button
                type="button"
                className="pin-btn"
                aria-pressed={isPinned}
                aria-label={`${isPinned ? "Unpin" : "Pin"} @${account.username}`}
                title={isPinned ? "Unpin from the top" : "Pin to the top"}
                onClick={(event) => {
                  event.stopPropagation();
                  onTogglePin(account.id);
                }}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <PinIcon />
              </button>

              <span className="account-state">
                <span className={`dot ${account.status}`} title={statusLabel(account.status)} />
                <span
                  className="account-age"
                  title={
                    account.checked_at
                      ? `Session checked ${timeAgo(account.checked_at)}`
                      : "Never checked"
                  }
                >
                  {account.checked_at ? timeAgo(account.checked_at) : "never"}
                </span>
              </span>
            </div>
          );
        })}

        {accounts.length === 0 && total > 0 && (
          <div className="list-empty">
            {filtered ? "Nothing matches these filters." : "No account matches that search."}
          </div>
        )}

        {total === 0 && (
          <div className="list-empty">
            No accounts yet.
            <br />
            Add one with its cookie to get started.
          </div>
        )}
      </div>
    </aside>
  );
}

function SortIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M3 9.4V2.6M3 2.6 1.5 4.1M3 2.6l1.5 1.5M9 2.6v6.8M9 9.4 7.5 7.9M9 9.4l1.5-1.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CaretIcon() {
  return (
    <svg width="7" height="7" viewBox="0 0 8 8" fill="none" aria-hidden="true">
      <path
        d="m1.5 3 2.5 2.5L6.5 3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.1 2.4h3.8l-.5 3.1 2.3 2.6H4.3l2.3-2.6-.5-3.1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8 8.2v5.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
