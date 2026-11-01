import { invoke } from "@tauri-apps/api/core";

export type AccountStatus = "ok" | "expired" | "unknown";

export type Account = {
  id: string;
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
  note: string;
  tags: string[];
  robux: number | null;
  status: AccountStatus;
  checked_at: string | null;
  added_at: string;
  /** The game this account joins by default; null opens Roblox's home page. */
  place_id: number | null;
  place_name: string;
  place_icon: string | null;
  /** Follow the app-wide graphics / frame-rate settings. */
  use_global_perf: boolean;
  low_graphics: boolean;
  fps_cap: number | null;
};

export type PlaceInfo = {
  place_id: number;
  universe_id: number;
  name: string;
  creator: string;
  icon_url: string | null;
};

export type ClientWindow = {
  pid: number;
  hwnd: number;
  width: number;
  height: number;
  minimized: boolean;
  account_id: string | null;
  /** The place this client is actually in, when Roblox's log says. */
  place_id: number | null;
};

export type LaunchConfig = {
  placeId: number | null;
  placeName: string;
  placeIcon: string | null;
  useGlobal: boolean;
  lowGraphics: boolean;
  fpsCap: number | null;
};

export type VaultStatus = {
  exists: boolean;
  unlocked: boolean;
  path: string;
};

export type FriendRequest = {
  user_id: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
  created: string | null;
};

export type BulkRow = {
  label: string;
  outcome: "added" | "duplicate" | "failed";
  username: string | null;
  error: string | null;
};

export type BulkResult = {
  rows: BulkRow[];
  accounts: Account[];
};

/** The seven colours a theme stores; the rest of the palette is derived. */
export type Theme = {
  id: string;
  name: string;
  bg: string;
  panel: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
};

export type Prefs = {
  multi_instance: boolean;
  multi_instance_asked: boolean;
  fps_cap: number | null;
  monitor_sessions: boolean;
  anti_afk: boolean;
  theme: Theme;
  custom_themes: Theme[];
};

export const api = {
  vaultStatus: () => invoke<VaultStatus>("vault_status"),
  createVault: (password: string) => invoke<Account[]>("vault_create", { password }),
  unlock: (password: string) => invoke<Account[]>("vault_unlock", { password }),
  lock: () => invoke<void>("vault_lock"),
  list: () => invoke<Account[]>("accounts_list"),
  add: (cookie: string, note: string, tags: string[]) =>
    invoke<Account>("account_add", { cookie, note, tags }),
  bulkAdd: (cookies: string, note: string, tags: string[]) =>
    invoke<BulkResult>("accounts_bulk_add", { cookies, note, tags }),
  refresh: (id: string) => invoke<Account>("account_refresh", { id }),
  refreshAll: () => invoke<Account[]>("account_refresh_all"),
  checkSessions: () => invoke<Account[]>("accounts_check_sessions"),
  setSessionMonitor: (enabled: boolean) => invoke<Prefs>("session_monitor_set", { enabled }),
  antiAfk: () => invoke<boolean>("anti_afk_get"),
  setAntiAfk: (enabled: boolean) => invoke<boolean>("anti_afk_set", { enabled }),
  update: (id: string, note: string, tags: string[]) =>
    invoke<Account>("account_update", { id, note, tags }),
  remove: (id: string) => invoke<Account[]>("account_remove", { id }),
  cookie: (id: string) => invoke<string>("account_cookie", { id }),
  /** Swaps in a fresh cookie for an existing account, keeping its settings. */
  recookie: (id: string, cookie: string) =>
    invoke<Account>("account_recookie", { id, cookie }),
  launch: (id: string, placeId: number | null) =>
    invoke<string>("launch_account", { id, placeId }),
  saveLaunchConfig: (id: string, config: LaunchConfig) =>
    invoke<Account>("account_launch_config_set", {
      id,
      placeId: config.placeId,
      placeName: config.placeName,
      placeIcon: config.placeIcon,
      useGlobalPerf: config.useGlobal,
      lowGraphics: config.lowGraphics,
      fpsCap: config.fpsCap,
    }),
  placeLookup: (placeId: number) => invoke<PlaceInfo>("place_lookup", { placeId }),
  clients: () => invoke<ClientWindow[]>("clients_list"),
  clientFocus: (hwnd: number) => invoke<void>("client_focus", { hwnd }),
  protocol: () => invoke<boolean>("roblox_protocol"),
  multiInstance: () => invoke<boolean>("multi_instance_get"),
  setMultiInstance: (enabled: boolean) =>
    invoke<boolean>("multi_instance_set", { enabled }),
  lowMemory: () => invoke<boolean>("low_memory_get"),
  setLowMemory: (enabled: boolean) => invoke<boolean>("low_memory_set", { enabled }),
  prefs: () => invoke<Prefs>("prefs_get"),
  onboardingDone: (enabled: boolean) => invoke<Prefs>("onboarding_done", { enabled }),
  setFpsCap: (cap: number | null) => invoke<Prefs>("fps_cap_set", { cap }),
  themeSet: (theme: Theme) => invoke<Prefs>("theme_set", { theme }),
  themeSaveCustom: (theme: Theme) => invoke<Prefs>("theme_save_custom", { theme }),
  themeDeleteCustom: (id: string) => invoke<Prefs>("theme_delete_custom", { id }),
  friendRequests: (id: string) => invoke<FriendRequest[]>("friends_list", { id }),
  friendAccept: (id: string, userId: number) => invoke<void>("friend_accept", { id, userId }),
  friendDecline: (id: string, userId: number) => invoke<void>("friend_decline", { id, userId }),
  friendSend: (id: string, username: string) => invoke<string>("friend_send", { id, username }),
};

/** Tauri rejects with a plain string; anything else is unexpected. */
export function message(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}
