import type { Account } from "../api";
import { statusLabel } from "../utils";
import { Avatar } from "./Avatar";

type Props = {
  accounts: Account[];
  total: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  picked: Set<string>;
  onTogglePick: (id: string) => void;
  onPickAll: () => void;
};

export function AccountList({
  accounts,
  total,
  selectedId,
  onSelect,
  picked,
  onTogglePick,
  onPickAll,
}: Props) {
  const allPicked = accounts.length > 0 && accounts.every((a) => picked.has(a.id));

  return (
    <aside className="list-pane">
      <div className="list-head">
        <span>All accounts</span>
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

      <div className="list-scroll">
        {accounts.map((account) => {
          const isPicked = picked.has(account.id);
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

              <span className={`dot ${account.status}`} title={statusLabel(account.status)} />
            </div>
          );
        })}

        {accounts.length === 0 && total > 0 && (
          <div className="list-empty">No account matches that search.</div>
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
