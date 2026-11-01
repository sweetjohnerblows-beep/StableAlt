import { useCallback, useEffect, useState } from "react";
import { api, message, type Account, type FriendRequest } from "../api";
import { Avatar } from "./Avatar";

type Props = {
  account: Account;
  onClose: () => void;
};

export function FriendsDialog({ account, onClose }: Props) {
  const [requests, setRequests] = useState<FriendRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [username, setUsername] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRequests(await api.friendRequests(account.id));
    } catch (err) {
      setError(message(err));
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [account.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function accept(request: FriendRequest) {
    setBusyId(request.user_id);
    setError(null);
    setNote(null);
    try {
      await api.friendAccept(account.id, request.user_id);
      setRequests((prev) => (prev ?? []).filter((r) => r.user_id !== request.user_id));
      setNote(`Accepted @${request.username}.`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusyId(null);
    }
  }

  async function decline(request: FriendRequest) {
    setBusyId(request.user_id);
    setError(null);
    setNote(null);
    try {
      await api.friendDecline(account.id, request.user_id);
      setRequests((prev) => (prev ?? []).filter((r) => r.user_id !== request.user_id));
      setNote(`Declined @${request.username}.`);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusyId(null);
    }
  }

  async function send() {
    if (sending || !username.trim()) return;
    setSending(true);
    setError(null);
    setNote(null);
    try {
      const name = await api.friendSend(account.id, username.trim());
      setNote(`Friend request sent to @${name}.`);
      setUsername("");
    } catch (err) {
      setError(message(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal friends-modal" role="dialog" aria-modal="true" aria-labelledby="friends-title">
        <div className="modal-head">
          <div>
            <h2 id="friends-title">Friends</h2>
            <p>Acting as @{account.username}. Requests go straight to Roblox.</p>
          </div>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="friend-add">
          <input
            className="field"
            placeholder="Roblox username"
            aria-label="Roblox username"
            value={username}
            spellCheck={false}
            onChange={(event) => setUsername(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void send();
            }}
          />
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void send()}
            disabled={sending || !username.trim()}
          >
            {sending ? <span className="spinner dark" /> : null}
            Send request
          </button>
        </div>

        {error && <p className="modal-error">{error}</p>}
        {note && <p className="modal-note">{note}</p>}

        <div className="friend-head">
          <h3>Pending requests{requests ? ` · ${requests.length}` : ""}</h3>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void load()} disabled={loading}>
            {loading ? <span className="spinner" /> : null}
            Refresh
          </button>
        </div>

        <div className="friend-list">
          {loading && requests === null && (
            <div className="empty-inline">
              <span className="spinner" />
            </div>
          )}

          {!loading && requests !== null && requests.length === 0 && (
            <div className="empty-inline">No pending requests.</div>
          )}

          {requests?.map((request) => (
            <div className="friend" key={request.user_id}>
              <Avatar name={request.display_name || request.username} url={request.avatar_url} />
              <div className="friend-meta">
                <div className="friend-name">{request.display_name || request.username}</div>
                <div className="friend-sub">@{request.username}</div>
              </div>
              <div className="friend-actions">
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  onClick={() => void accept(request)}
                  disabled={busyId !== null}
                >
                  {busyId === request.user_id ? <span className="spinner dark" /> : null}
                  Accept
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => void decline(request)}
                  disabled={busyId !== null}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
