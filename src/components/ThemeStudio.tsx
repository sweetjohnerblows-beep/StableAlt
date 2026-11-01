import { useEffect, useState } from "react";
import { DEFAULT_THEME, PRESETS, apply, type Theme } from "../themes";

type Props = {
  theme: Theme;
  customThemes: Theme[];
  onChooseTheme: (theme: Theme) => void;
  onSaveTheme: (theme: Theme) => void;
  onDeleteTheme: (id: string) => void;
};

const FIELDS = [
  { key: "bg", label: "Background" },
  { key: "panel", label: "Panels" },
  { key: "line", label: "Borders" },
  { key: "text", label: "Text" },
  { key: "muted", label: "Muted text" },
  { key: "accent", label: "Accent" },
] as const;

type ColorKey = (typeof FIELDS)[number]["key"];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A miniature of the app: page, a raised panel, and the accent. */
function Swatch({ theme }: { theme: Theme }) {
  return (
    <span className="swatch" style={{ background: theme.bg }} aria-hidden="true">
      <span
        className="swatch-panel"
        style={{ background: theme.panel, borderColor: theme.line }}
      >
        <span className="swatch-line" style={{ background: theme.line }} />
        <span className="swatch-line short" style={{ background: theme.line }} />
      </span>
      <span className="swatch-dot" style={{ background: theme.accent }} />
    </span>
  );
}

export function ThemeStudio({
  theme,
  customThemes,
  onChooseTheme,
  onSaveTheme,
  onDeleteTheme,
}: Props) {
  /** A theme being edited. While it is set, the window shows it live. */
  const [draft, setDraft] = useState<Theme | null>(null);

  useEffect(() => {
    if (draft) apply(draft);
  }, [draft]);

  const all = [...PRESETS, ...customThemes];
  const editable = draft !== null && all.every((item) => item.id !== draft.id);
  const valid = draft !== null && FIELDS.every((field) => HEX.test(draft[field.key]));

  function edit(source: Theme) {
    setDraft({ ...source });
  }

  function blank() {
    edit({
      ...DEFAULT_THEME,
      id: `custom-${Date.now().toString(36)}`,
      name: "My theme",
    });
  }

  function stopEditing() {
    setDraft(null);
    // Undo the preview: put the theme that is actually saved back on screen.
    apply(theme);
  }

  function update(key: ColorKey, value: string) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function save() {
    if (!draft || !valid) return;
    const name = draft.name.trim() || "My theme";
    onSaveTheme({ ...draft, name });
    setDraft(null);
  }

  const isMine = (item: Theme) => customThemes.some((custom) => custom.id === item.id);

  return (
    <section className="settings-card">
      <header className="settings-head">
        <h2>Appearance</h2>
        <p>
          Themes recolour the whole app — panels, borders, buttons and every glow — not just the
          accent. Pick one, or build your own and it applies as you drag the colours.
        </p>
      </header>

      <div className="theme-grid" role="group" aria-label="Themes">
        {all.map((item) => {
          const active = theme.id === item.id && !draft;
          return (
            <div key={item.id} className={active ? "theme-card active" : "theme-card"}>
              <button
                type="button"
                className="theme-pick"
                aria-pressed={active}
                onClick={() => {
                  setDraft(null);
                  onChooseTheme(item);
                }}
              >
                <Swatch theme={item} />
                <span className="theme-name">{item.name}</span>
                {isMine(item) && <span className="theme-tag">Custom</span>}
              </button>

              {isMine(item) && (
                <div className="theme-actions">
                  <button
                    type="button"
                    className="theme-action"
                    onClick={() => edit(item)}
                    aria-label={`Edit ${item.name}`}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="theme-action danger"
                    onClick={() => {
                      if (draft?.id === item.id) setDraft(null);
                      onDeleteTheme(item.id);
                    }}
                    aria-label={`Delete ${item.name}`}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <button type="button" className="theme-card new" onClick={blank}>
          <span className="theme-plus">+</span>
          <span className="theme-name">Build your own</span>
        </button>
      </div>

      {draft && (
        <div className="theme-studio">
          <div className="theme-studio-head">
            <div>
              <div className="setting-title">
                {editable ? "New theme" : "Editing a saved theme"}
                <span className={valid ? "chip ok" : "chip"}>
                  {valid ? "Live preview" : "Invalid colour"}
                </span>
              </div>
              <p>Every other shade is mixed from these six, so the app stays consistent.</p>
            </div>
          </div>

          <label className="field-label" htmlFor="theme-name">
            Name
          </label>
          <input
            id="theme-name"
            className="field"
            value={draft.name}
            maxLength={28}
            onChange={(event) =>
              setDraft((current) => (current ? { ...current, name: event.target.value } : current))
            }
          />

          <div className="color-grid">
            {FIELDS.map((field) => (
              <label className="color-field" key={field.key}>
                <span>{field.label}</span>
                <span className="color-input">
                  <input
                    type="color"
                    value={HEX.test(draft[field.key]) ? draft[field.key] : "#000000"}
                    onChange={(event) => update(field.key, event.target.value)}
                    aria-label={`${field.label} colour`}
                  />
                  <input
                    className="field mono"
                    value={draft[field.key]}
                    spellCheck={false}
                    maxLength={7}
                    onChange={(event) => update(field.key, event.target.value.trim())}
                    aria-label={`${field.label} hex`}
                  />
                </span>
              </label>
            ))}
          </div>

          <div className="theme-studio-foot">
            <button className="btn btn-ghost" type="button" onClick={stopEditing}>
              Cancel
            </button>
            <button className="btn btn-primary" type="button" onClick={save} disabled={!valid}>
              Save and use
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
