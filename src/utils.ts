const robuxFormat = new Intl.NumberFormat("en-US");

export function formatRobux(value: number | null): string {
  return value === null ? "—" : `R$ ${robuxFormat.format(value)}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "Never checked";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never checked";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

export function statusLabel(status: string): string {
  if (status === "ok") return "Active";
  if (status === "expired") return "Signed out";
  return "Unchecked";
}

/** Accepts a bare place id or any roblox.com game URL. */
export function parsePlaceId(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  const match = trimmed.match(/\/games\/(\d+)/) ?? trimmed.match(/[?&]placeId=(\d+)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of input.split(",")) {
    const tag = raw.trim().slice(0, 24);
    if (tag) seen.add(tag);
  }
  return [...seen].slice(0, 12);
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // WebView2 can refuse the async clipboard without a user gesture chain.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(area);
  if (!ok) throw new Error("Could not copy to the clipboard.");
}
