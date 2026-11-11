import type { ChangeEvent, CSSProperties } from "react";
import { applyTheme, saveTheme, type Theme } from "../lib/theme.ts";

type Props = {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
};

const fieldset: CSSProperties = {
  border: "1px solid var(--divider)",
  borderRadius: "var(--radius-card)",
  background: "var(--surface)",
  padding: "var(--space-4)",
  display: "flex",
  gap: "var(--space-5)",
  maxWidth: "480px",
};

const legend: CSSProperties = {
  padding: "0 var(--space-2)",
  fontSize: "var(--text-md)",
  fontWeight: 600,
};

const label: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--space-2)",
  cursor: "pointer",
};

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
];

export function SettingsScreen({ theme, onThemeChange }: Props) {
  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.value === "dark" ? "dark" : "light";
    applyTheme(next);
    onThemeChange(next);
    void saveTheme(next).catch(() => {
      // The theme is already applied; a failed save only means it will not survive a restart.
    });
  }

  return (
    <section aria-labelledby="settings-title">
      <h2 id="settings-title">Ajustes</h2>
      <fieldset style={fieldset}>
        <legend style={legend}>Tema</legend>
        {OPTIONS.map((option) => (
          <label key={option.value} style={label}>
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={theme === option.value}
              onChange={handleChange}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    </section>
  );
}
