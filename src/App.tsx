import { useEffect, useMemo, useRef, useState } from "react";
import { api, message, type Account, type LaunchConfig, type Prefs, type VaultStatus } from "./api";
import { copyText } from "./utils";
import { AccountDetail } from "./components/AccountDetail";
import { AccountList, SORTS, type SortKey, type StatusFilter } from "./components/AccountList";
import { CommandPalette } from "./components/CommandPalette";
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

// The list's order and its pins belong to this window, not to the vault: they
// are how you like to look at the accounts, not anything about the accounts.
const SORT_STORE = "stablealt.sort";
const PIN_STORE = "stablealt.pinned";

function readSort(): SortKey {
  try {
    const raw = localStorage.getItem(SORT_STORE);
    return SORTS.some((entry) => entry.id === raw) ? (raw as SortKey) : "name";
  } catch {
    return "name";
  }
}

function readPins(): Set<string> {
  try {
    const raw = localStorage.getItem(PIN_STORE);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(
      Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export default function App() {
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>(readSort);
  const [pinned, setPinned] = useState<Set<string>>(readPins);
  const [paletteOpen, setPaletteOpen] = useState(false);
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
  const [queueTarget, setQueueTarget] = useState<string | null>(null);
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
    try {
      localStorage.setItem(SORT_STORE, sortKey);
    } catch {
      /* storage can be unavailable; the order still holds for this session */
    }
  }, [sortKey]);

  useEffect(() => {
    try {
      localStorage.setItem(PIN_STORE, JSON.stringify([...pinned]));
    } catch {
      /* same */
    }
  }, [pinned]);

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
    const needsAttention = (account: Account) =>
      account.status === "expired" ? 0 : account.status === "unknown" ? 1 : 2;
    const order: Record<SortKey, (a: Account, b: Account) => number> = {
      name: byName,
      // Newest launch first; accounts that never launched sink to the bottom.
      launch: (a, b) => (b.last_job_at ?? "").localeCompare(a.last_job_at ?? "") || byName(a, b),
      balance: (a, b) => (b.robux ?? -1) - (a.robux ?? -1) || byName(a, b),
      attention: (a, b) => needsAttention(a) - needsAttention(b) || byName(a, b),
    };

    return accounts
      .filter((account) => {
        if (stateFilter !== "all" && account.status !== stateFilter) return false;
        if (filterTag !== null && !account.tags.includes(filterTag)) return false;
        if (!needle) return true;
        return [account.username, account.display_name, account.note, ...account.tags]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => {
        // Pinned accounts lead whatever the order is; everything else keeps it.
        const pa = pinned.has(a.id) ? 0 : 1;
        const pb = pinned.has(b.id) ? 0 : 1;
        return pa !== pb ? pa - pb : order[sortKey](a, b);
      });
  }, [accounts, query, filterTag, stateFilter, sortKey, pinned]);

  /** Every tag in the vault, most used first — the filter bar, not the editor. */
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const account of accounts) {
      for (const tag of account.tags) {
        const key = tag.trim();
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [accounts]);

  const statusCounts = useMemo<Record<StatusFilter, number>>(
    () => ({
      all: accounts.length,
      ok: accounts.filter((a) => a.status === "ok").length,
      expired: accounts.filter((a) => a.status === "expired").length,
      unknown: accounts.filter((a) => a.status === "unknown").length,
    }),
    [accounts],
  );

  // A tag can disappear while it is being used as a filter.
  useEffect(() => {
    if (filterTag !== null && !tagCounts.some((entry) => entry.tag === filterTag)) {
      setFilterTag(null);
    }
  }, [filterTag, tagCounts]);

  // Ctrl/Cmd+K from anywhere in the window.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  async function launch(id: string, placeId: number | null, jobId?: string) {
    setBusy("launch");
    try {
      await api.launch(id, placeId, jobId);
      setToast({
        kind: "ok",
        text: multiInstance
          ? jobId
            ? "Joining that server in a new Roblox client…"
            : placeId
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
      setPinned((prev) => {
        if (!prev.has(id)) return prev;
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

  function togglePin(id: string) {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  /**
   * Opens each account in turn, spaced out for Roblox's ticket limits.
   *
   * A `target` pins every launch to one place and one server, which is how
   * several alts end up in the same lobby instead of scattered across servers.
   */
  async function launchMany(
    ids: string[],
    target?: { placeId: number; jobId: string; label?: string },
  ) {
    if (ids.length === 0) return;

    stopRef.current = false;
    const items: QueueItem[] = ids.map((id) => {
      const account = accounts.find((a) => a.id === id);
      return { id, name: account ? `@${account.username}` : id, state: "pending" };
    });
    setQueueTarget(target?.label ?? null);
    setQueue(items);

    for (let index = 0; index < items.length; index += 1) {
      if (stopRef.current) break;

      const mark = (state: QueueItem["state"], error?: string) =>
        setQueue((current) =>
          current && current.map((item, at) => (at === index ? { ...item, state, error } : item)),
        );

      mark("launching");
      try {
        // Without a target, `null` means "whatever this account is set to join".
        await api.launch(items[index].id, target?.placeId ?? null, target?.jobId ?? null);
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

  async function toggleCloseToTray() {
    const next = !(prefs?.close_to_tray ?? true);
    setBusy("tray");
    try {
      setPrefs(await api.setCloseToTray(next));
      setToast({
        kind: "ok",
        text: next
          ? "Closing the window now keeps StableAlt in the tray."
          : "Closing the window now quits StableAlt.",
      });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    } finally {
      setBusy(null);
    }
  }

  async function toggleAutoRejoin() {
    const next = !(prefs?.auto_rejoin ?? true);
    setBusy("rejoin");
    try {
      setPrefs(await api.setAutoRejoin(next));
      setToast({
        kind: "ok",
        text: next
          ? "Auto-rejoin on — a client that closes reopens in the same game."
          : "Auto-rejoin off — a closed client stays closed.",
      });
    } catch (err) {
      setToast({ kind: "error", text: message(err) });
    } finally {
      setBusy(null);
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
      <header className="appbar">
        <div className="brand">
          <LogoMark size={20} />
          <span className="brand-name">
            Stable<em>Alt</em>
          </span>
        </div>

        <nav className="tabs" aria-label="Sections">
          <button
            type="button"
            className={view === "accounts" ? "tab active" : "tab"}
            onClick={() => setView("accounts")}
            title={`${accounts.length} saved · ${liveCount} live`}
            aria-current={view === "accounts" ? "page" : undefined}
          >
            Accounts
            {accounts.length > 0 && <span className="tab-count">{accounts.length}</span>}
          </button>
          <button
            type="button"
            className={view === "monitor" ? "tab active" : "tab"}
            onClick={() => setView("monitor")}
            aria-current={view === "monitor" ? "page" : undefined}
          >
            Clients
          </button>
          <button
            type="button"
            className={view === "settings" ? "tab active" : "tab"}
            onClick={() => setView("settings")}
            aria-current={view === "settings" ? "page" : undefined}
          >
            Settings
          </button>
        </nav>

        <div className="appbar-tools">
          {view === "accounts" && (
            <>
              <div className="search">
                <SearchIcon />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search accounts"
                  aria-label="Search accounts, notes and tags"
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="search-key"
                  onClick={() => setPaletteOpen(true)}
                  title="Quick launch (Ctrl+K)"
                >
                  Ctrl K
                </button>
              </div>

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
            </>
          )}

          <button
            type="button"
            className="icon-btn"
            onClick={lock}
            title="Lock vault"
            aria-label="Lock vault"
          >
            <LockIcon />
          </button>
        </div>
      </header>

      <div className="main">
        <h1 className="sr-only">
          {view === "accounts" ? "Accounts" : view === "monitor" ? "Clients" : "Settings"}
        </h1>
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
                tags={tagCounts}
                filterTag={filterTag}
                onFilterTag={setFilterTag}
                stateFilter={stateFilter}
                onStateFilter={setStateFilter}
                statusCounts={statusCounts}
                sortKey={sortKey}
                onSort={setSortKey}
                pinned={pinned}
                onTogglePin={togglePin}
              />

              {selected ? (
                <AccountDetail
                  // Keyed so drafts, the game editor and the server list belong to
                  // the account on screen and cannot leak into the next one.
                  key={selected.id}
                  account={selected}
                  busy={busy}
                  protocolOk={protocolOk}
                  onRefresh={() => refresh(selected.id)}
                  onLaunch={(placeId, jobId) => launch(selected.id, placeId, jobId)}
                  pickedCount={picked.size}
                  onJoinMany={(placeId, jobId) =>
                    void launchMany([...picked], {
                      placeId,
                      jobId,
                      label: `${selected.place_name || `Place ${placeId}`} · server ${jobId.slice(0, 8)}`,
                    })
                  }
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
              autoRejoin={prefs?.auto_rejoin ?? true}
              onToggleAutoRejoin={toggleAutoRejoin}
              closeToTray={prefs?.close_to_tray ?? true}
              onToggleCloseToTray={toggleCloseToTray}
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
              onRestored={(list) => {
                setAccounts(list);
                setToast({ kind: "ok", text: "Backup restored." });
              }}
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
          target={queueTarget}
          running={queue.some((item) => item.state === "pending" || item.state === "launching")}
          multiInstance={multiInstance}
          onStop={() => {
            stopRef.current = true;
          }}
          onClose={() => {
            setQueue(null);
            setQueueTarget(null);
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

      <CommandPalette
        open={paletteOpen}
        accounts={visible}
        busy={busy !== null}
        onClose={() => setPaletteOpen(false)}
        onLaunch={(id) => {
          setPaletteOpen(false);
          void launch(id, null);
        }}
        onSelect={(id) => {
          setPaletteOpen(false);
          setSelectedId(id);
          setView("accounts");
        }}
        onView={(next) => {
          setPaletteOpen(false);
          setView(next);
        }}
      />

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
