import type { Theme } from "../lib/theme.ts";
import { Icon } from "./Icon.tsx";
import { ThemeSwitch } from "./ThemeSwitch.tsx";
import styles from "./TopBar.module.css";

type Props = {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  /** Sits over the page without a background, for the Home. */
  floating?: boolean;
};

/** The bar before a review is open: the app's mark and the theme. The review has its own. */
export function TopBar({ theme, onThemeChange, floating = false }: Props) {
  return (
    <header className={floating ? `${styles.root} ${styles.floating}` : styles.root}>
      <span className={styles.mark} role="img" aria-label="Mejores Tomas">
        <Icon name="camera" size={18} />
      </span>
      <ThemeSwitch theme={theme} onThemeChange={onThemeChange} />
    </header>
  );
}
