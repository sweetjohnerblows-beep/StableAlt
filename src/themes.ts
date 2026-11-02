/**
 * Themes.
 *
 * The stylesheet runs entirely on custom properties, so a theme is just a
 * palette written onto the document root. Only seven colours are stored per
 * theme; every other surface, border and wash is mixed from them here. That
 * keeps a custom theme coherent instead of letting someone pick six colours and
 * end up with a panel that still belongs to the old palette.
 *
 * The tokens are flat by design: surfaces are told apart by a border and a small
 * step in tone, not by light and shadow. Only what floats above the window
 * (dialogs, the palette, a toast) gets a shadow.
 */

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

export const PRESETS: Theme[] = [
  {
    id: "steel",
    name: "Steel",
    bg: "#0f1116",
    panel: "#14171e",
    line: "#242a35",
    text: "#e9ecf2",
    muted: "#8a93a3",
    accent: "#8b7cff",
  },
  {
    id: "ink",
    name: "Ink",
    bg: "#0b0c0f",
    panel: "#111216",
    line: "#1e2026",
    text: "#e8eaee",
    muted: "#82868f",
    accent: "#cfd6e4",
  },
  {
    id: "rust",
    name: "Rust",
    bg: "#16100c",
    panel: "#1d1611",
    line: "#30231a",
    text: "#f3ece4",
    muted: "#a5968a",
    accent: "#e07a3c",
  },
  {
    id: "cobalt",
    name: "Cobalt",
    bg: "#0b0f18",
    panel: "#111725",
    line: "#1d2740",
    text: "#e8eefc",
    muted: "#8090ad",
    accent: "#5b8dff",
  },
  {
    id: "jade",
    name: "Jade",
    bg: "#0b1210",
    panel: "#111a17",
    line: "#1d2b26",
    text: "#e8f2ee",
    muted: "#829a92",
    accent: "#35c98e",
  },
  {
    id: "ice",
    name: "Ice",
    bg: "#0c1114",
    panel: "#131a1e",
    line: "#202c32",
    text: "#e6f0f4",
    muted: "#82949d",
    accent: "#59d3e8",
  },
  {
    id: "plum",
    name: "Plum",
    bg: "#0f0b14",
    panel: "#171020",
    line: "#281c38",
    text: "#efe9f7",
    muted: "#9b8bab",
    accent: "#c86dd7",
  },
  {
    id: "carbon",
    name: "Carbon",
    bg: "#0a0a0c",
    panel: "#101114",
    line: "#1d1e23",
    text: "#f0f1f4",
    muted: "#7f828a",
    accent: "#f0f1f4",
  },
  {
    id: "sand",
    name: "Sand",
    bg: "#f2f0eb",
    panel: "#fbfaf7",
    line: "#dcd6ca",
    text: "#17181a",
    muted: "#6f6b61",
    accent: "#b4471f",
  },
  {
    id: "galaxy",
    name: "Galaxy",
    bg: "#05060f",
    panel: "#0a0c1c",
    line: "#1b2040",
    text: "#e9eaff",
    muted: "#8d92bd",
    accent: "#a97bff",
  },
  {
    id: "nebula",
    name: "Nebula",
    bg: "#0c0613",
    panel: "#150a20",
    line: "#2b1541",
    text: "#f7e9ff",
    muted: "#a487bd",
    accent: "#ff5fa2",
  },
  {
    id: "aurora",
    name: "Aurora",
    bg: "#04100f",
    panel: "#081a19",
    line: "#12302a",
    text: "#e6f7f2",
    muted: "#7fa79c",
    accent: "#43e0b0",
  },
  {
    id: "synthwave",
    name: "Synthwave",
    bg: "#0b0413",
    panel: "#150826",
    line: "#33134f",
    text: "#f8e9ff",
    muted: "#a087bd",
    accent: "#ff3d8b",
  },
  {
    id: "matcha",
    name: "Matcha",
    bg: "#eff2e7",
    panel: "#f9fbf3",
    line: "#d6ddc8",
    text: "#1a2015",
    muted: "#69735b",
    accent: "#4f7a26",
  },
  {
    id: "sakura",
    name: "Sakura",
    bg: "#faf0f3",
    panel: "#fff8fa",
    line: "#ecd5dd",
    text: "#231619",
    muted: "#7d6a70",
    accent: "#c2386b",
  },
];

/**
 * Background washes, keyed by preset id.
 *
 * A theme is still seven colours; this is the weather on top of them. The
 * layers are painted behind the panes, and a theme listed here also switches
 * those panes to frosted glass, so the wash reads through instead of being
 * sealed behind an opaque fill. Custom themes get none — the colour editor
 * never has to explain a fourth kind of setting.
 *
 * Everything is a `background-image` layer with no size or repeat, so each one
 * covers the window and stars are just dots placed at a percentage.
 */
const ATMOSPHERE: Record<string, string> = {
  galaxy: [
    "linear-gradient(118deg, transparent 26%, rgb(168 150 255 / 0.16) 44%, rgb(90 150 255 / 0.1) 54%, transparent 74%)",
    "radial-gradient(120% 90% at 10% -10%, rgb(106 78 200 / 0.62), transparent 58%)",
    "radial-gradient(95% 75% at 92% 6%, rgb(40 104 180 / 0.5), transparent 60%)",
    "radial-gradient(85% 65% at 62% 112%, rgb(146 62 190 / 0.4), transparent 64%)",
    "radial-gradient(2px 2px at 14% 22%, rgb(255 255 255 / 0.95), transparent 100%)",
    "radial-gradient(1.4px 1.4px at 27% 61%, rgb(226 232 255 / 0.8), transparent 100%)",
    "radial-gradient(2.4px 2.4px at 38% 12%, rgb(255 255 255 / 1), transparent 100%)",
    "radial-gradient(1.4px 1.4px at 46% 78%, rgb(255 255 255 / 0.7), transparent 100%)",
    "radial-gradient(1.8px 1.8px at 58% 34%, rgb(236 240 255 / 0.9), transparent 100%)",
    "radial-gradient(1.3px 1.3px at 67% 68%, rgb(255 255 255 / 0.65), transparent 100%)",
    "radial-gradient(2px 2px at 72% 18%, rgb(255 255 255 / 0.9), transparent 100%)",
    "radial-gradient(1.3px 1.3px at 81% 52%, rgb(226 232 255 / 0.75), transparent 100%)",
    "radial-gradient(1.6px 1.6px at 88% 84%, rgb(255 255 255 / 0.85), transparent 100%)",
    "radial-gradient(1.3px 1.3px at 22% 88%, rgb(255 255 255 / 0.65), transparent 100%)",
    "radial-gradient(2px 2px at 93% 32%, rgb(255 255 255 / 0.95), transparent 100%)",
  ].join(", "),
  nebula: [
    "radial-gradient(85% 70% at 22% 10%, rgb(255 95 162 / 0.36), transparent 60%)",
    "radial-gradient(80% 65% at 88% 18%, rgb(122 70 255 / 0.4), transparent 62%)",
    "radial-gradient(70% 60% at 55% 104%, rgb(80 140 255 / 0.22), transparent 64%)",
    "radial-gradient(1.8px 1.8px at 18% 34%, rgb(255 255 255 / 0.9), transparent 100%)",
    "radial-gradient(1.3px 1.3px at 31% 74%, rgb(255 236 250 / 0.7), transparent 100%)",
    "radial-gradient(1.5px 1.5px at 44% 20%, rgb(255 255 255 / 0.8), transparent 100%)",
    "radial-gradient(1.3px 1.3px at 57% 58%, rgb(255 236 250 / 0.65), transparent 100%)",
    "radial-gradient(1.7px 1.7px at 69% 86%, rgb(255 255 255 / 0.85), transparent 100%)",
    "radial-gradient(1.3px 1.3px at 76% 28%, rgb(255 255 255 / 0.7), transparent 100%)",
    "radial-gradient(1.5px 1.5px at 86% 62%, rgb(255 236 250 / 0.75), transparent 100%)",
  ].join(", "),
  aurora: [
    "radial-gradient(65% 55% at 16% 4%, rgb(67 224 176 / 0.34), transparent 62%)",
    "radial-gradient(55% 45% at 72% -2%, rgb(120 200 255 / 0.26), transparent 66%)",
    "linear-gradient(104deg, transparent 18%, rgb(67 224 176 / 0.16) 27%, transparent 36%)",
    "linear-gradient(76deg, transparent 52%, rgb(120 200 255 / 0.14) 61%, transparent 70%)",
    "radial-gradient(85% 60% at 46% 114%, rgb(84 116 255 / 0.24), transparent 62%)",
  ].join(", "),
  synthwave: [
    "linear-gradient(to bottom, rgb(11 4 19 / 0.95) 0%, rgb(11 4 19 / 0.5) 26%, transparent 60%)",
    "repeating-linear-gradient(to right, rgb(255 61 139 / 0.2) 0 1px, transparent 1px 64px)",
    "repeating-linear-gradient(to bottom, rgb(255 61 139 / 0.2) 0 1px, transparent 1px 46px)",
    "radial-gradient(130% 80% at 50% 116%, rgb(255 122 61 / 0.45), transparent 60%)",
    "radial-gradient(95% 55% at 50% -8%, rgb(150 60 255 / 0.4), transparent 62%)",
  ].join(", "),
  matcha: [
    "radial-gradient(70% 60% at 8% -4%, rgb(79 122 38 / 0.1), transparent 60%)",
    "radial-gradient(70% 60% at 94% 6%, rgb(186 208 140 / 0.35), transparent 64%)",
    "radial-gradient(95% 60% at 50% 112%, rgb(242 238 214 / 0.85), transparent 58%)",
  ].join(", "),
  sakura: [
    "radial-gradient(75% 60% at 10% 0%, rgb(194 56 107 / 0.12), transparent 60%)",
    "radial-gradient(70% 55% at 90% 6%, rgb(255 160 190 / 0.32), transparent 64%)",
    "radial-gradient(95% 65% at 48% 112%, rgb(255 214 226 / 0.9), transparent 58%)",
  ].join(", "),
};

/** The wash a theme paints behind the panes, or undefined for a flat one. */
export function atmosphereFor(theme: Theme): string | undefined {
  return ATMOSPHERE[theme.id];
}

export const DEFAULT_THEME = PRESETS[0];

type Rgb = { r: number; g: number; b: number };

function parse(hex: string): Rgb {
  const digits = hex.replace("#", "");
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((c) => c + c)
          .join("")
      : digits.slice(0, 6);
  return {
    r: parseInt(full.slice(0, 2), 16) || 0,
    g: parseInt(full.slice(2, 4), 16) || 0,
    b: parseInt(full.slice(4, 6), 16) || 0,
  };
}

function hex({ r, g, b }: Rgb): string {
  const part = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** `amount` of `to` mixed into `from`; 0 returns `from`, 1 returns `to`. */
function mix(from: string, to: string, amount: number): string {
  const a = parse(from);
  const b = parse(to);
  return hex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

function luminance(hexColor: string): number {
  const { r, g, b } = parse(hexColor);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const WHITE = "#ffffff";
const BLACK = "#000000";

/** Text that stays readable on top of the accent colour. */
function inkOn(accent: string): string {
  const onDark = (luminance(accent) + 0.05) / (luminance(BLACK) + 0.05);
  const onLight = (luminance(WHITE) + 0.05) / (luminance(accent) + 0.05);
  return onDark >= onLight ? mix(BLACK, accent, 0.12) : mix(WHITE, accent, 0.06);
}

export function isLight(theme: Theme): boolean {
  return luminance(theme.bg) > 0.5;
}

/**
 * Every custom property the stylesheet reads. Derived values always move
 * `panel` towards `text`, so raised surfaces lighten on a dark theme and darken
 * on a light one without a separate code path.
 */
export function variables(theme: Theme): Record<string, string> {
  const { r, g, b } = parse(theme.accent);
  const light = isLight(theme);
  // A control's edge must be tellable from the ground (3:1), so it is a real mix of the two and
  // not the same hairline the panels use between them.
  const edge = mix(theme.panel, theme.text, light ? 0.42 : 0.32);
  // On a light deck the accent is for fills, not words: text needs the darker end of it.
  const on = light ? mix(theme.accent, BLACK, 0.34) : mix(theme.accent, WHITE, 0.04);
  return {
    "--bg": theme.bg,
    "--atmos": ATMOSPHERE[theme.id] ?? "none",
    "--bg-rail": theme.panel,
    "--panel": theme.panel,
    "--panel-2": mix(theme.panel, theme.text, light ? 0.055 : 0.045),
    "--panel-3": mix(theme.panel, theme.text, light ? 0.1 : 0.08),
    "--line": theme.line,
    "--line-2": mix(theme.line, theme.text, 0.14),
    "--line-strong": edge,
    "--ink": theme.text,
    "--ink-2": mix(theme.text, theme.bg, 0.3),
    "--muted": theme.muted,
    "--accent": theme.accent,
    "--accent-rgb": `${r} ${g} ${b}`,
    "--accent-hi": mix(theme.accent, WHITE, 0.14),
    "--accent-lo": mix(theme.accent, BLACK, 0.16),
    "--accent-ink": inkOn(theme.accent),
    "--accent-soft": `rgb(${r} ${g} ${b} / 0.13)`,
    "--accent-edge": `rgb(${r} ${g} ${b} / 0.42)`,
    "--hover": mix(theme.panel, theme.text, light ? 0.04 : 0.035),
    "--well": theme.bg,
    // The one shadow in the app: things that float above the window.
    "--shadow-pop": light ? "0 20px 44px rgb(38 34 24 / 0.2)" : "0 20px 44px rgb(0 0 0 / 0.58)",
    "--hair": light ? "rgb(16 20 28 / 0.08)" : "rgb(255 255 255 / 0.06)",
    "--on": on,
    "--on-ink": inkOn(on),
    "--focus": on,
    "--primary": theme.accent,
    // Kept flat: nothing in the interface is moulded out of the background any more.
    "--face": "none",
    "--sh": "transparent",
    "--hl": "transparent",
    "--raise": "none",
    "--raise-sm": "none",
    "--press": "none",
    "--shadow": "var(--shadow-pop)",
    "--ok": light ? "#0f7a6a" : "#4fd6a8",
    "--warn": light ? "#8a5a00" : "#f2b64a",
    "--bad": light ? "#b42318" : "#ff6b7a",
  };
}

/** Writes the theme onto the document, replacing whatever was there. */
export function apply(theme: Theme) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(variables(theme))) {
    root.style.setProperty(key, value);
  }
  root.dataset.theme = theme.id;
  // Only a theme with a wash gets the frosted panes that let it show through.
  if (ATMOSPHERE[theme.id]) root.dataset.atmos = "glass";
  else delete root.dataset.atmos;
  // Lets the browser draw scrollbars and form controls to match.
  root.style.colorScheme = isLight(theme) ? "light" : "dark";
}

export function byId(id: string, custom: Theme[] = []): Theme {
  return (
    PRESETS.find((theme) => theme.id === id) ??
    custom.find((theme) => theme.id === id) ??
    DEFAULT_THEME
  );
}
