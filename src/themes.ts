/**
 * Themes.
 *
 * The stylesheet runs entirely on custom properties, so a theme is just a
 * palette written onto the document root. Only seven colours are stored per
 * theme; every other surface, border and wash is mixed from them here. That
 * keeps a custom theme coherent instead of letting someone pick six colours and
 * end up with a panel that still belongs to the old palette.
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
    id: "ember",
    name: "Ember",
    bg: "#06070a",
    panel: "#0d1015",
    line: "#1c212a",
    text: "#f1f3f7",
    muted: "#6f7889",
    accent: "#ff6a4d",
  },
  {
    id: "midnight",
    name: "Midnight",
    bg: "#05070d",
    panel: "#0b101c",
    line: "#1b2740",
    text: "#eef2ff",
    muted: "#7686ab",
    accent: "#5b8cff",
  },
  {
    id: "iris",
    name: "Iris",
    bg: "#08060f",
    panel: "#120e1e",
    line: "#292044",
    text: "#f3effd",
    muted: "#8278a0",
    accent: "#a06bff",
  },
  {
    id: "abyss",
    name: "Abyss",
    bg: "#030809",
    panel: "#08161a",
    line: "#14343c",
    text: "#e6fbfa",
    muted: "#6b9399",
    accent: "#22d3c5",
  },
  {
    id: "sable",
    name: "Sable",
    bg: "#0b0805",
    panel: "#15100a",
    line: "#2c2216",
    text: "#f8f2e6",
    muted: "#988b71",
    accent: "#e5a13c",
  },
  {
    id: "rose",
    name: "Rose",
    bg: "#0b0508",
    panel: "#150a10",
    line: "#2d1521",
    text: "#fdeef3",
    muted: "#9a7481",
    accent: "#ff3d68",
  },
  {
    id: "graphite",
    name: "Graphite",
    bg: "#0a0a0b",
    panel: "#121215",
    line: "#26262c",
    text: "#f4f4f6",
    muted: "#7c7c86",
    accent: "#e6e6ee",
  },
  {
    id: "bone",
    name: "Bone",
    bg: "#f3f0ea",
    panel: "#ffffff",
    line: "#ded7c9",
    text: "#1a1917",
    muted: "#746d61",
    accent: "#c2410c",
  },
];

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
  return {
    "--bg": theme.bg,
    "--bg-rail": mix(theme.bg, theme.panel, 0.55),
    "--panel": theme.panel,
    "--panel-2": mix(theme.panel, theme.text, 0.055),
    "--panel-3": mix(theme.panel, theme.text, 0.095),
    "--line": theme.line,
    "--line-2": mix(theme.line, theme.text, 0.1),
    "--ink": theme.text,
    "--ink-2": mix(theme.text, theme.bg, 0.32),
    "--muted": theme.muted,
    "--accent": theme.accent,
    "--accent-rgb": `${r}, ${g}, ${b}`,
    "--accent-hi": mix(theme.accent, WHITE, 0.16),
    "--accent-lo": mix(theme.accent, BLACK, 0.12),
    "--accent-ink": inkOn(theme.accent),
    "--accent-soft": `rgba(${r}, ${g}, ${b}, 0.12)`,
  };
}

/** Writes the theme onto the document, replacing whatever was there. */
export function apply(theme: Theme) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(variables(theme))) {
    root.style.setProperty(key, value);
    root.dataset.theme = theme.id;
  }
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
