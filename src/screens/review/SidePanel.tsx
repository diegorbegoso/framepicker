import type { SelectedBurst, SelectedPhoto } from "../../lib/engine.ts";
import styles from "../ReviewScreen.module.css";
import { ScoresPanel } from "./ScoresPanel.tsx";
import { SettingsPanel } from "./SettingsPanel.tsx";
import { ShortcutsHelp } from "./ShortcutsHelp.tsx";

type Props = {
  sessionId: string;
  photo: SelectedPhoto | undefined;
  onApplied: (bursts: SelectedBurst[]) => void;
  onError: (message: string | null) => void;
};

/** The review's right column: scores, selection settings and the shortcuts. */
export function SidePanel({ sessionId, photo, onApplied, onError }: Props) {
  return (
    <aside aria-label="Panel de la ráfaga" className={styles.side}>
      <ScoresPanel photo={photo} />
      <SettingsPanel sessionId={sessionId} onApplied={onApplied} onError={onError} />
      <ShortcutsHelp />
    </aside>
  );
}
