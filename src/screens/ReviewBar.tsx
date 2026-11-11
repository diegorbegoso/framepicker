import { Icon } from "../components/Icon.tsx";
import { SegmentedControl } from "../components/SegmentedControl.tsx";
import { ThemeSwitch } from "../components/ThemeSwitch.tsx";
import type { Theme } from "../lib/theme.ts";
import { ActionsBar, type ExportRequest } from "./ActionsBar.tsx";
import styles from "./ReviewBar.module.css";
import type { ScopeIds } from "./review/scopes.ts";

export type Mode = "bursts" | "grid";

type Props = {
  mode: Mode;
  onMode: (mode: Mode) => void;
  sessionId: string;
  pickedCount: number;
  scopes: ScopeIds;
  exportRequest: ExportRequest | null;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onLutsChanged: () => void;
  onBusy: (busy: boolean) => void;
};

/** The one bar at the top of a review: the two views, the main functions and the theme. */
export function ReviewBar({
  mode,
  onMode,
  sessionId,
  pickedCount,
  scopes,
  exportRequest,
  theme,
  onThemeChange,
  onLutsChanged,
  onBusy,
}: Props) {
  return (
    <div className={styles.root}>
      <span className={styles.mark} role="img" aria-label="Mejores Tomas">
        <Icon name="camera" size={16} />
      </span>
      <SegmentedControl
        label="Vista"
        value={mode}
        options={[
          { value: "bursts", label: "Ráfagas", icon: "images" },
          { value: "grid", label: "Cuadrícula", icon: "grid" },
        ]}
        onChange={onMode}
      />
      <span className={styles.total}>{pickedCount} elegidas</span>
      <ActionsBar
        sessionId={sessionId}
        scopes={scopes}
        exportRequest={exportRequest}
        onLutsChanged={onLutsChanged}
        onBusy={onBusy}
      />
      <ThemeSwitch theme={theme} onThemeChange={onThemeChange} />
    </div>
  );
}
