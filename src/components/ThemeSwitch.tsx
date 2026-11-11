import { applyTheme, saveTheme, type Theme } from "../lib/theme.ts";
import { Icon } from "./Icon.tsx";
import styles from "./ThemeSwitch.module.css";

type Props = {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
};

/** Light or dark, one click. The choice is applied at once and saved for the next start. */
export function ThemeSwitch({ theme, onThemeChange }: Props) {
  const dark = theme === "dark";

  function toggle() {
    const next: Theme = dark ? "light" : "dark";
    applyTheme(next);
    onThemeChange(next);
    void saveTheme(next).catch(() => {
      // The theme is already applied; a failed save only means it will not survive a restart.
    });
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Modo oscuro"
      title={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className={styles.root}
      onClick={toggle}
    >
      <span className={styles.thumb}>
        <Icon name={dark ? "moon" : "sun"} size={14} />
      </span>
    </button>
  );
}
