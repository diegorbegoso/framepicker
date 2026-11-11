import type { SelectedBurst, SelectedPhoto } from "../../lib/engine.ts";
import { ExportPanel } from "../ExportPanel.tsx";
import styles from "../ReviewScreen.module.css";
import { ScoresPanel } from "./ScoresPanel.tsx";
import { SettingsPanel } from "./SettingsPanel.tsx";
import { ShortcutsHelp } from "./ShortcutsHelp.tsx";

type Props = {
  sessionId: string;
  photo: SelectedPhoto | undefined;
  selectedCount: number;
  onApplied: (bursts: SelectedBurst[]) => void;
  onError: (message: string | null) => void;
};

/** The review's right column: scores, selection settings, export and the shortcuts. */
export function SidePanel({ sessionId, photo, selectedCount, onApplied, onError }: Props) {
  return (
    <aside aria-label="Panel de la ráfaga" className={styles.side}>
      <ScoresPanel photo={photo} />
      <SettingsPanel sessionId={sessionId} onApplied={onApplied} onError={onError} />
      <ExportPanel sessionId={sessionId} selectedCount={selectedCount} />
      <ShortcutsHelp />
    </aside>
  );
}
