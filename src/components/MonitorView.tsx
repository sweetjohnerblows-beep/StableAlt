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
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [layoutNote, setLayoutNote] = useState<string | null>(null);
  const [copiedJob, setCopiedJob] = useState<string | null>(null);

  // One place that knows how to ask the backend to rearrange windows, so the four
  // buttons can't drift apart in how they report success or failure.
  async function arrange(kind: "normal" | "micro" | "minimize" | "restore") {
    if (layoutBusy) return;
    setLayoutBusy(true);
    try {
      if (kind === "normal" || kind === "micro") {
        const moved = await api.tileClients(kind);
        setLayoutNote(`Tiled ${moved} client${moved === 1 ? "" : "s"}.`);
      } else if (kind === "minimize") {
        const hidden = await api.minimizeClients();
        setLayoutNote(
          hidden === 0
            ? "Every client was already minimised."
            : `Minimised ${hidden} client${hidden === 1 ? "" : "s"}.`
        );
      } else {
        const shown = await api.restoreClients();
        setLayoutNote(
          shown === 0 ? "Nothing was minimised." : `Restored ${shown} client${shown === 1 ? "" : "s"}.`
        );
      }
      setNonce((n) => n + 1);
    } catch (err) {
      setLayoutNote(message(err));
    } finally {
      setLayoutBusy(false);
    }
  }

  /** Lines up every window that is in one server, leaving the rest alone. */
  async function groupServer(job: string) {
    const hwnds = clients
      .filter((client) => client.job_id === job)
      .map((client) => client.hwnd)
      .filter((hwnd) => hwnd !== 0);
    if (hwnds.length === 0 || layoutBusy) return;
    setLayoutBusy(true);
    try {
      const moved = await api.tileGroup(hwnds);
      setLayoutNote(
        `Tiled ${moved} client${moved === 1 ? "" : "s"} from that server into one half of the screen.`,
      );
      setNonce((n) => n + 1);
    } catch (err) {
      setLayoutNote(message(err));
    } finally {
      setLayoutBusy(false);
    }
  }

  useEffect(() => {
    if (!layoutNote) return;
    const timer = window.setTimeout(() => setLayoutNote(null), 4000);
    return () => window.clearTimeout(timer);
  }, [layoutNote]);

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
  // How many windows sit in each server: two alts in the same lobby is the
  // thing this view exists to make obvious.
  const perServer = new Map<string, number>();
  for (const client of clients) {
    if (client.account_id) byAccount.set(client.account_id, client);
    if (client.job_id) perServer.set(client.job_id, (perServer.get(client.job_id) ?? 0) + 1);
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
            onClick={() => void arrange("normal")}
            disabled={layoutBusy || open === 0}
            title="Lay every client out in a grid on your screen"
          >
            Tile all
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void arrange("micro")}
            disabled={layoutBusy || open === 0}
            title="Tile every client as a small window — readable, but cheap to keep open"
          >
            Micro
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void arrange("minimize")}
            disabled={layoutBusy || open === 0}
            title="Minimise every client without closing anything"
          >
            Minimise
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void arrange("restore")}
            disabled={layoutBusy || open === 0}
            title="Bring every minimised client back"
          >
            Restore
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
      {layoutNote && <div className="monitor-note">{layoutNote}</div>}

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

              {client?.job_id && (
                <div className="client-server">
                  <span className="client-server-label">Server</span>
                  <button
                    type="button"
                    className="server-id"
                    title={`${client.job_id} — click to copy`}
                    onClick={() => {
                      const job = client.job_id;
                      if (!job) return;
                      navigator.clipboard
                        ?.writeText(job)
                        .then(() => {
                          setCopiedJob(job);
                          window.setTimeout(
                            () => setCopiedJob((current) => (current === job ? null : current)),
                            1500,
                          );
                        })
                        .catch(() => {
                          /* the full id is in the tooltip either way */
                        });
                    }}
                  >
                    {copiedJob === client.job_id ? "Copied" : client.job_id.slice(0, 8)}
                  </button>
                  {(perServer.get(client.job_id) ?? 1) > 1 && (
                    <button
                      type="button"
                      className="server-shared"
                      onClick={() => void groupServer(client.job_id as string)}
                      disabled={layoutBusy}
                      title={`Tile these ${perServer.get(
                        client.job_id,
                      )} windows together in one half of the screen, leaving the other half and every other client alone`}
                    >
                      Group {perServer.get(client.job_id)}
                    </button>
                  )}
                </div>
              )}

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
