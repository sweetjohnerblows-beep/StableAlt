import { useEffect, useRef, useState } from "react";
import { api, message, type Account, type ClientWindow, type PlaceInfo } from "../api";
import { Avatar } from "./Avatar";

type Props = {
  accounts: Account[];
  antiAfk: boolean;
  busy: string | null;
  onToggleAntiAfk: () => void;
  onLaunch: (id: string) => void;
  onSelect: (id: string) => void;
};

const LIST_GAP = 5000;

export function MonitorView({
  accounts,
  antiAfk,
  busy,
  onToggleAntiAfk,
  onLaunch,
  onSelect,
}: Props) {
  const [clients, setClients] = useState<ClientWindow[]>([]);
  const [games, setGames] = useState<Record<number, PlaceInfo>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const askedGames = useRef<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;

    async function poll() {
      try {
        const list = await api.clients();
        if (!alive) return;
        setClients(list);
        setError(null);
      } catch (err) {
        if (!alive) return;
        setError(message(err));
      } finally {
        if (alive) setLoaded(true);
      }
    }

    void poll();
    const timer = window.setInterval(poll, LIST_GAP);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [nonce]);

  // Place names come from Roblox, once per place rather than once per poll.
  useEffect(() => {
    let alive = true;
    for (const client of clients) {
      const id = client.place_id;
      if (!id || askedGames.current.has(id)) continue;
      askedGames.current.add(id);
      api
        .placeLookup(id)
        .then((info) => {
          if (alive) setGames((prev) => ({ ...prev, [id]: info }));
        })
        .catch(() => {
          /* the card falls back to the account's own game name */
        });
    }
    return () => {
      alive = false;
    };
  }, [clients]);

  const byAccount = new Map<string, ClientWindow>();
  for (const client of clients) {
    if (client.account_id) byAccount.set(client.account_id, client);
  }
  const unlinked = clients.filter((client) => !client.account_id);
  const open = clients.length;

  const cards = [
    ...accounts.map((account) => ({ account, client: byAccount.get(account.id) })),
    ...unlinked.map((client) => ({ account: null, client })),
  ];

  return (
    <div className="monitor">
      <header className="monitor-head">
        <div>
          <h2>
            {open} client{open === 1 ? "" : "s"} open
          </h2>
          <p>Which account each window belongs to, and what it's playing.</p>
        </div>
        <div className="monitor-tools">
          <button
            type="button"
            className={antiAfk ? "pill-btn on" : "pill-btn"}
            onClick={onToggleAntiAfk}
            disabled={busy === "afk"}
            aria-pressed={antiAfk}
            title="Poke every open client with a Tab press so Roblox doesn't kick it for being idle"
          >
            <span className="dot" />
            Anti-AFK {antiAfk ? "on" : "off"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setNonce((n) => n + 1)}
          >
            Refresh
          </button>
        </div>
      </header>

      {error && <div className="monitor-empty">{error}</div>}

      {loaded && cards.length === 0 && (
        <div className="monitor-empty">
          <strong>Nothing running yet</strong>
          Launch an account and its client shows up here.
        </div>
      )}

      <div className="monitor-grid">
        {cards.map(({ account, client }) => {
          const name = account ? account.display_name || account.username : "Unlinked window";
          const handle = account ? `@${account.username}` : `pid ${client?.pid ?? "—"}`;
          // What it's playing beats what it was set to launch.
          const live = client?.place_id ? games[client.place_id] : undefined;
          const game =
            live?.name ||
            account?.place_name ||
            (client?.place_id
              ? `Place ${client.place_id}`
              : account?.place_id
                ? `Place ${account.place_id}`
                : "Not in a game yet");
          const gameIcon = live?.icon_url ?? null;

          return (
            <article
              className={client ? "client-card live" : "client-card"}
              key={account?.id ?? `pid-${client?.pid}`}
            >
              <div className="client-head">
                <Avatar name={name} url={account?.avatar_url ?? null} />
                <div className="client-id">
                  <strong>{name}</strong>
                  <span>{handle}</span>
                </div>
                <span className={!client ? "client-state" : client.minimized ? "client-state idle" : "client-state live"}>
                  <span className="dot" />
                  {!client ? "closed" : client.minimized ? "minimised" : "open"}
                </span>
              </div>

              <div className="client-game">
                {gameIcon ? (
                  <img className="game-icon" src={gameIcon} alt="" loading="lazy" />
                ) : (
                  <span className="game-dot" />
                )}
                <em>{game}</em>
              </div>

              <div className="client-foot">
                <span className="client-size">
                  {client ? `${client.width}×${client.height}` : "no window"}
                </span>
                <div className="monitor-actions">
                  {client ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => void api.clientFocus(client.hwnd)}
                    >
                      Focus
                    </button>
                  ) : (
                    account && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => onLaunch(account.id)}
                        disabled={busy === "launch"}
                      >
                        Launch
                      </button>
                    )
                  )}
                  {account && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => onSelect(account.id)}
                    >
                      Open
                    </button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
