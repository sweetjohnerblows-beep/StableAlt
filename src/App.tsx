import { useEffect, useMemo, useRef, useState } from "react";
import { api, message, type Account, type LaunchConfig, type Prefs, type VaultStatus } from "./api";
import { copyText } from "./utils";
import { AccountDetail } from "./components/AccountDetail";
import { AccountList } from "./components/AccountList";
import { AddAccountDialog } from "./components/AddAccountDialog";
import { BatchLaunchDialog, type QueueItem } from "./components/BatchLaunchDialog";
import { BulkImportDialog } from "./components/BulkImportDialog";
import { FriendsDialog } from "./components/FriendsDialog";
import { LogoMark } from "./components/Logo";
import { LockScreen } from "./components/LockScreen";
import { MonitorView } from "./components/MonitorView";
import { Onboarding } from "./components/Onboarding";
import { RecookieDialog } from "./components/RecookieDialog";
import { SettingsView } from "./components/SettingsView";
import { DEFAULT_THEME, apply as applyTheme, type Theme } from "./themes";
import { Splash } from "./components/Splash";

type Toast = { kind: "ok" | "error"; text: string };
type View = "accounts" | "monitor" | "settings";

const byName = (a: Account, b: Account) =>
  (a.display_name || a.username).localeCompare(b.display_name || b.username, undefined, {
    sensitivity: "base",
  });

export default function App() {
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("accounts");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [recookieOpen, setRecookieOpen] = useState(false);
  const [protocolOk, setProtocolOk] = useState(true);
  const [multiInstance, setMultiInstanceState] = useState(true);
  const [lowMemory, setLowMemoryState] = useState(true);
  const [antiAfk, setAntiAfkState] = useState(false);
  const [booting, setBooting] = useState(true);
  const [splashDone, setSplashDone] = useState(false);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const [fpsCap, setFpsCapState] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    // The splash is part of the app's personality, not a spinner: give it a
    // moment even when the vault opens instantly.
    const timer = window.setTimeout(() => setSplashDone(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [status, saved] = await Promise.all([api.vaultStatus(), api.prefs()]);
        if (!alive) return;
        setVault(status);
        setPrefs(saved);
        setFpsCapState(saved.fps_cap);
        setMultiInstanceState(saved.multi_instance);
        if (status.unlocked) {
          const list = await api.list();
          if (!alive) return;
          setAccounts(list);
          setSelectedId(list[0]?.id ?? null);
        }
      } catch (err) {
        if (alive) setToast({ kind: "error", text: message(err) });
      } finally {
        if (alive) setBooting(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Paint the theme as soon as preferences arrive, and again whenever it changes.
  // Everything on screen is driven by custom properties, so this is the only
  // place a theme has to be applied.
  useEffect(() => {
    applyTheme(prefs?.theme ?? DEFAULT_THEME);
  }, [prefs?.theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!vault?.unlocked) return;
    let alive = true;
    api
      .protocol()
      .then((ok) => alive && setProtocolOk(ok))
      .catch(() => alive && setProtocolOk(false));
    api
      .multiInstance()
      .then((on) => alive && setMultiInstanceState(on))
      .catch(() => alive && setMultiInstanceState(false));
    api
      .lowMemory()
      .then((on) => alive && setLowMemoryState(on))
      .catch(() => alive && setLowMemoryState(false));
    api
      .antiAfk()
      .then((on) => alive && setAntiAfkState(on))
      .catch(() => alive && setAntiAfkState(false));
    return () => {
      alive = false;
    };
  }, [vault?.unlocked]);

  // Quiet session sweep: no balances, no avatars, no toast. A dead cookie just
  // turns the row's dot red before you try to launch it.
  useEffect(() => {
    if (!vault?.unlocked || !prefs?.monitor_sessions || accounts.length === 0) return;

    let alive = true;
    const sweep = () => {
      api
        .checkSessions()
        .then((list) => {
          if (alive) setAccounts(list);
        })
        .catch(() => {
          /* offline or locked mid-flight; the next sweep tries again */
        });
    };

    const kick = window.setTimeout(sweep, 12_000);
    const timer = window.setInterval(sweep, 5 * 60_000);
    return () => {
      alive = false;
      window.clearTimeout(kick);
      window.clearInterval(timer);
    };
  }, [vault?.unlocked, prefs?.monitor_sessions, accounts.length > 0]);

  useEffect(() => {
    if (accounts.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !accounts.some((a) => a.id === selectedId)) {
      setSelectedId(accounts[0].id);
    }
  }, [accounts, selectedId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter((account) =>
      [account.username, account.display_name, account.note, ...account.tags]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [accounts, query]);

  const selected = accounts.find((a) => a.id === selectedId) ?? null;
  const liveCount = accounts.filter((a) => a.status === "ok").length;

  async function handleUnlock(password: string) {
    const list = await api.unlock(password);
    setVault((v) => (v ? { ...v, unlocked: true } : v));
    setAccounts(list);
    setSelectedId(list[0]?.id ?? null);
  }

  async function handleCreate(password: string) {
    const list = await api.createVault(password);
    setVault((v) => (v ? { ...v, exists: true, unlocked: true } : v));
    setAccounts(list);
    setSelectedId(null);
  }

  async function lock() {
    try {
      await api.lock();
      setAccounts([]);
      setSelectedId(null);
      setQuery("");
      setView("accounts");
      setAddOpen(false);
      setVault((v) => (v ? { ...v, unlocked: false } : v));
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    }
  }

  async function addAccount(cookie: string, note: string, tags: string[]) {
    const account = await api.add(cookie, note, tags);
    setAccounts((prev) => [...prev, account].sort(byName));
    setSelectedId(account.id);
    setView("accounts");
    setToast({ kind: "ok", text: `@${account.username} added to the vault.` });
  }

  /** Imports a pasted list; results come back per row so the dialog can show them. */
  async function importMany(cookies: string, note: string, tags: string[]) {
    const result = await api.bulkAdd(cookies, note, tags);
    setAccounts(result.accounts);

    const added = result.rows.filter((row) => row.outcome === "added").length;
    const skipped = result.rows.filter((row) => row.outcome === "duplicate").length;
    const failed = result.rows.filter((row) => row.outcome === "failed").length;
    setToast({
      kind: added > 0 ? "ok" : "error",
      text:
        added > 0
          ? `${added} account${added === 1 ? "" : "s"} added${skipped > 0 ? ` · ${skipped} already saved` : ""}${failed > 0 ? ` · ${failed} failed` : ""}.`
          : skipped > 0 && failed === 0
            ? "Those accounts are already in the vault."
            : "Nothing could be imported — check the cookie values.",
    });
    return result;
  }

  async function refresh(id: string) {
    setBusy("refresh");
    try {
      const updated = await api.refresh(id);
      setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)));
      setToast({
        kind: "ok",
        text: `@${updated.username} is still signed in · ${
          updated.robux === null ? "balance hidden" : `R$ ${updated.robux.toLocaleString()}`
        }`,
      });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
      try {
        setAccounts(await api.list());
      } catch {
        /* vault got locked mid-flight; the lock screen takes over */
      }
    } finally {
      setBusy(null);
    }
  }

  async function refreshAll() {
    setBusy("refreshAll");
    try {
      const list = await api.refreshAll();
      setAccounts(list);
      const live = list.filter((a) => a.status === "ok").length;
      setToast({ kind: "ok", text: `Checked ${list.length} accounts · ${live} still signed in.` });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    } finally {
      setBusy(null);
    }
  }

  async function launch(id: string, placeId: number | null) {
    setBusy("launch");
    try {
      await api.launch(id, placeId);
      setToast({
        kind: "ok",
        text: multiInstance
          ? placeId
            ? `Handing place ${placeId} to a new Roblox client…`
            : "Opening a new Roblox client…"
          : "Launched — but multi-instance is off, so Windows may just focus your open client.",
      });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
      // A failed launch can also change an account's status (Roblox may have
      // rotated or revoked the session), so pull the list back in line.
      try {
        setAccounts(await api.list());
      } catch {
        /* vault is fine; the toast already explains the launch failure */
      }
    } finally {
      setBusy(null);
    }
  }

  async function copyCookie(id: string) {
    setBusy("copy");
    try {
      await copyText(await api.cookie(id));
      setToast({ kind: "ok", text: "Cookie copied — treat it like a password." });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    } finally {
      setBusy(null);
    }
  }

  /** Keeps note, tags and launch options; only the cookie is replaced. */
  async function recookie(id: string, cookie: string) {
    setBusy("recookie");
    try {
      const updated = await api.recookie(id, cookie);
      setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)));
      setToast({ kind: "ok", text: `@${updated.username} reconnected.` });
    } catch (err) {
      setBusy(null);
      throw err;
    }
    setBusy(null);
  }

  async function saveConfig(id: string, config: LaunchConfig) {
    try {
      const updated = await api.saveLaunchConfig(id, config);
      setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)));
      setToast({ kind: "ok", text: "Launch options saved." });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
      throw err;
    }
  }

  async function saveNote(id: string, note: string, tags: string[]) {
    setBusy("save");
    try {
      const updated = await api.update(id, note, tags);
      setAccounts((prev) => prev.map((a) => (a.id === id ? updated : a)));
      setToast({ kind: "ok", text: "Saved." });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy("remove");
    try {
      setAccounts(await api.remove(id));
      setPicked((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setToast({ kind: "ok", text: "Account removed from the vault." });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    } finally {
      setBusy(null);
    }
  }

  /** First-run answer. Returns a message to show instead of dismissing. */
  async function chooseMultiInstance(enabled: boolean): Promise<string | null> {
    try {
      const next = await api.onboardingDone(enabled);
      setPrefs(next);
      setMultiInstanceState(next.multi_instance);
      if (enabled && !next.multi_instance) {
        return "A Roblox client is already running, so it owns the lock. Close every Roblox window, then try again — or switch it on later in Settings.";
      }
      setOnboardingDismissed(true);
      return null;
    } catch (err) {
      return message(err);
    }
  }

  async function changeFpsCap(cap: number | null) {
    setBusy("fps");
    try {
      const next = await api.setFpsCap(cap);
      setPrefs(next);
      setFpsCapState(next.fps_cap);
      setToast({
        kind: "ok",
        text: cap ? `Frame-rate cap set to ${cap} FPS for new clients.` : "Frame-rate cap removed.",
      });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    } finally {
      setBusy(null);
    }
  }

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function pickAll() {
    setPicked((prev) => {
      const everythingPicked = visible.length > 0 && visible.every((a) => prev.has(a.id));
      return everythingPicked ? new Set() : new Set(visible.map((a) => a.id));
    });
  }

  /** Opens each account in turn, spaced out for Roblox's ticket limits. */
  async function launchMany(ids: string[]) {
    if (ids.length === 0) return;

    stopRef.current = false;
    const items: QueueItem[] = ids.map((id) => {
      const account = accounts.find((a) => a.id === id);
      return { id, name: account ? `@${account.username}` : id, state: "pending" };
    });
    setQueue(items);

    for (let index = 0; index < items.length; index += 1) {
      if (stopRef.current) break;

      const mark = (state: QueueItem["state"], error?: string) =>
        setQueue((current) =>
          current && current.map((item, at) => (at === index ? { ...item, state, error } : item)),
        );

      mark("launching");
      try {
        // `null` means "whatever this account is set to join".
        await api.launch(items[index].id, null);
        mark("done");
      } catch (err) {
        mark("failed", message(err));
      }

      if (index < items.length - 1 && !stopRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 3000));
      }
    }

    setQueue((current) =>
      current &&
      current.map((item) =>
        item.state === "pending" ? { ...item, state: "failed", error: "Stopped" } : item,
      ),
    );
  }

  async function toggleSessionMonitor() {
    setBusy("monitor");
    try {
      const next = await api.setSessionMonitor(!(prefs?.monitor_sessions ?? true));
      setPrefs(next);
      setToast({
        kind: "ok",
        text: next.monitor_sessions
          ? "Session monitor on — expired accounts get flagged every few minutes."
          : "Session monitor off — accounts only update when you refresh them.",
      });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    } finally {
      setBusy(null);
    }
  }

  async function applyPreset(id: string) {
    const wantLow = id !== "defaults";
    const wantCap = id === "max" ? 30 : id === "balanced" ? 60 : null;

    setBusy("preset");
    try {
      const lowOn = await api.setLowMemory(wantLow);
      const next = await api.setFpsCap(wantCap);
      setLowMemoryState(lowOn);
      setPrefs(next);
      setFpsCapState(next.fps_cap);
      setToast({
        kind: "ok",
        text:
          id === "max"
            ? "Max alts — clients launch at lowest graphics with a 30 FPS cap."
            : id === "balanced"
              ? "Balanced — lowest graphics with a 60 FPS cap."
              : "Roblox defaults — your own graphics and frame rate are back.",
      });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    } finally {
      setBusy(null);
    }
  }

  async function toggleMultiInstance() {
    const next = !multiInstance;
    setBusy("multi");
    try {
      const on = await api.setMultiInstance(next);
      setMultiInstanceState(on);
      setToast({
        kind: "ok",
        text: on
          ? "Multi-instance on — a second account opens a second window."
          : "Multi-instance off — Windows keeps one Roblox client at a time.",
      });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    } finally {
      setBusy(null);
    }
  }

  async function toggleLowMemory() {
    const next = !lowMemory;
    setBusy("lowmem");
    try {
      const on = await api.setLowMemory(next);
      setLowMemoryState(on);
      setToast({
        kind: "ok",
        text: on
          ? "Lowest graphics on — new clients load at their minimum."
          : "Lowest graphics off — Roblox's own settings are back.",
      });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    } finally {
      setBusy(null);
    }
  }

  async function chooseTheme(theme: Theme) {
    try {
      setPrefs(await api.themeSet(theme));
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    }
  }

  async function saveTheme(theme: Theme) {
    try {
      setPrefs(await api.themeSaveCustom(theme));
      setToast({ kind: "ok", text: `${theme.name} saved and applied.` });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    }
  }

  async function deleteTheme(id: string) {
    try {
      setPrefs(await api.themeDeleteCustom(id));
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    }
  }

  async function toggleAntiAfk() {
    const next = !antiAfk;
    setBusy("afk");
    try {
      const on = await api.setAntiAfk(next);
      setAntiAfkState(on);
      setPrefs((current) => (current ? { ...current, anti_afk: on } : current));
      setToast({
        kind: "ok",
        text: on
          ? "Anti-AFK on — every open client gets a Tab press every two minutes."
          : "Anti-AFK off — clients are left alone.",
      });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    } finally {
      setBusy(null);
    }
  }

  if (booting || !splashDone || !prefs) {
    return <Splash />;
  }

  if (!prefs.multi_instance_asked && !onboardingDismissed) {
    return <Onboarding onChoose={chooseMultiInstance} />;
  }

  if (!vault || !vault.unlocked) {
    return (
      <LockScreen
        exists={vault?.exists ?? false}
        onCreate={handleCreate}
        onUnlock={handleUnlock}
      />
    );
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail-brand" aria-hidden="true">
          <LogoMark size={36} />
        </div>
        <nav className="rail-nav" aria-label="Sections">
          <button
            type="button"
            className={view === "accounts" ? "rail-btn active" : "rail-btn"}
            onClick={() => setView("accounts")}
            title="Accounts"
            aria-label="Accounts"
            aria-current={view === "accounts"}
          >
            <GridIcon />
          </button>
          <button
            type="button"
            className={view === "monitor" ? "rail-btn active" : "rail-btn"}
            onClick={() => setView("monitor")}
            title="Open clients"
            aria-label="Open clients"
            aria-current={view === "monitor"}
          >
            <MonitorIcon />
          </button>
          <button
            type="button"
            className={view === "settings" ? "rail-btn active" : "rail-btn"}
            onClick={() => setView("settings")}
            title="Settings"
            aria-label="Settings"
            aria-current={view === "settings"}
          >
            <SlidersIcon />
          </button>
        </nav>
        <div className="rail-foot">
          <button type="button" className="rail-btn" onClick={lock} title="Lock vault" aria-label="Lock vault">
            <LockIcon />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="page-title">
            <h1>
              {view === "accounts" ? "Accounts" : view === "monitor" ? "Clients" : "Settings"}
            </h1>
            <p>
              {view === "accounts"
                ? `${accounts.length} saved · ${liveCount} live`
                : view === "monitor"
                  ? "Every client you have open, with a live picture of each."
                  : "How clients start, and what happens to your vault."}
            </p>
          </div>

          {view === "accounts" && (
            <>
              <div className="search">
                <SearchIcon />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search accounts, notes, tags"
                  aria-label="Search accounts"
                  spellCheck={false}
                />
              </div>

              <div className="topbar-actions">
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={refreshAll}
                  disabled={busy === "refreshAll" || accounts.length === 0}
                >
                  {busy === "refreshAll" ? <span className="spinner" /> : <RefreshIcon />}
                  Refresh all
                </button>
                {picked.size > 0 ? (
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => void launchMany([...picked])}
                    disabled={busy !== null}
                  >
                    Launch {picked.size}
                  </button>
                ) : (
                  accounts.length > 0 && (
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => void launchMany(visible.map((a) => a.id))}
                      disabled={busy !== null}
                      title="Open every account, three seconds apart"
                    >
                      Launch all
                    </button>
                  )
                )}
                <button
                  className={picked.size > 0 ? "btn btn-secondary" : "btn btn-primary"}
                  type="button"
                  onClick={() => setAddOpen(true)}
                >
                  <PlusIcon />
                  Add account
                </button>
              </div>
            </>
          )}
        </header>

        <div className="content">
          {view === "accounts" ? (
            <div className="accounts">
              <AccountList
                accounts={visible}
                total={accounts.length}
                selectedId={selectedId}
                onSelect={setSelectedId}
                picked={picked}
                onTogglePick={togglePick}
                onPickAll={pickAll}
              />

              {selected ? (
                <AccountDetail
                  account={selected}
                  busy={busy}
                  protocolOk={protocolOk}
                  onRefresh={() => refresh(selected.id)}
                  onLaunch={(placeId) => launch(selected.id, placeId)}
                  onCopyCookie={() => copyCookie(selected.id)}
                  onOpenFriends={() => setFriendsOpen(true)}
                  onRecookie={() => setRecookieOpen(true)}
                  onSave={(note, tags) => saveNote(selected.id, note, tags)}
                  onSaveConfig={(config) => saveConfig(selected.id, config)}
                  onRemove={() => remove(selected.id)}
                />
              ) : (
                <section className="detail detail-empty">
                  <div>
                    <strong>No account selected</strong>
                    Pick an account on the left, or add one with its cookie.
                  </div>
                </section>
              )}
            </div>
          ) : view === "monitor" ? (
            <MonitorView
              accounts={accounts}
              antiAfk={antiAfk}
              busy={busy}
              onToggleAntiAfk={toggleAntiAfk}
              onLaunch={(id) => void launch(id, null)}
              onSelect={(id) => {
                setSelectedId(id);
                setView("accounts");
              }}
            />
          ) : (
            <SettingsView
              antiAfk={antiAfk}
              onToggleAntiAfk={toggleAntiAfk}
              multiInstance={multiInstance}
              lowMemory={lowMemory}
              monitorSessions={prefs?.monitor_sessions ?? true}
              onToggleMonitor={toggleSessionMonitor}
              fpsCap={fpsCap}
              busy={busy}
              accountCount={accounts.length}
              vaultPath={vault.path}
              onToggleMultiInstance={toggleMultiInstance}
              onToggleLowMemory={toggleLowMemory}
              onSetFpsCap={changeFpsCap}
              activePreset={
                lowMemory && fpsCap === 30
                  ? "max"
                  : lowMemory && fpsCap === 60
                    ? "balanced"
                    : !lowMemory && fpsCap === null
                      ? "defaults"
                      : null
              }
              onApplyPreset={applyPreset}
              theme={prefs.theme ?? DEFAULT_THEME}
              customThemes={prefs.custom_themes ?? []}
              onChooseTheme={chooseTheme}
              onSaveTheme={saveTheme}
              onDeleteTheme={deleteTheme}
              onLock={lock}
            />
          )}
        </div>
      </div>

      {addOpen && (
        <AddAccountDialog
          onAdd={addAccount}
          onBulkMode={() => {
            setAddOpen(false);
            setBulkOpen(true);
          }}
          onClose={() => setAddOpen(false)}
        />
      )}

      {bulkOpen && (
        <BulkImportDialog onImport={importMany} onClose={() => setBulkOpen(false)} />
      )}

      {queue && (
        <BatchLaunchDialog
          items={queue}
          running={queue.some((item) => item.state === "pending" || item.state === "launching")}
          multiInstance={multiInstance}
          onStop={() => {
            stopRef.current = true;
          }}
          onClose={() => {
            setQueue(null);
            setPicked(new Set());
          }}
        />
      )}

      {recookieOpen && selected && (
        <RecookieDialog
          key={selected.id}
          accountName={`@${selected.username}`}
          onReplace={(cookie) => recookie(selected.id, cookie)}
          onClose={() => setRecookieOpen(false)}
        />
      )}

      {friendsOpen && selected && (
        <FriendsDialog
          key={selected.id}
          account={selected}
          onClose={() => setFriendsOpen(false)}
        />
      )}

      {toast && (
        <div className={`toast ${toast.kind}`} role="status">
          <span className="toast-dot" />
          {toast.text}
        </div>
      )}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13.3 8a5.3 5.3 0 1 1-1.6-3.8M13.5 2.4v3.2h-3.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.2" y="7" width="9.6" height="6.4" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.6 7V5.3a2.4 2.4 0 0 1 4.8 0V7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.4" y="2.4" width="5.4" height="5.4" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10.2" y="2.4" width="5.4" height="5.4" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2.4" y="10.2" width="5.4" height="5.4" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10.2" y="10.2" width="5.4" height="5.4" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="1.9" y="2.8" width="14.2" height="9.4" rx="1.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M6.4 15.2h5.2M9 12.2v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function SlidersIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M3 5.5h12M3 12.5h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="7" cy="5.5" r="2" fill="var(--panel)" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="11.5" cy="12.5" r="2" fill="var(--panel)" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
