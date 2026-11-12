import type { LutInfo, SelectedBurst, SelectedPhoto } from "../../lib/engine.ts";
import styles from "../ReviewScreen.module.css";
import { CorrectionsPanel } from "./CorrectionsPanel.tsx";
import { ScoresPanel } from "./ScoresPanel.tsx";
import { SettingsPanel } from "./SettingsPanel.tsx";
import { ShortcutsHelp } from "./ShortcutsHelp.tsx";
import type { Scope } from "./scopes.ts";
import type { Edits } from "./useEdits.ts";

type Props = {
  sessionId: string;
  photo: SelectedPhoto | undefined;
  bursts: SelectedBurst[];
  marked: ReadonlySet<string>;
  edits: Edits;
  luts: LutInfo[];
  onLutsChanged?: () => void;
  onExport: (scope: Scope) => void;
  onApplied: (bursts: SelectedBurst[]) => void;
  onError: (message: string | null) => void;
};

/** The review's right column: corrections, scores, selection settings and the shortcuts. */
export function SidePanel({
  sessionId,
  photo,
  bursts,
  marked,
  edits,
  luts,
  onLutsChanged,
  onExport,
  onApplied,
  onError,
}: Props) {
  return (
    <aside aria-label="Panel de la ráfaga" className={styles.side}>
      <CorrectionsPanel
        sessionId={sessionId}
        onError={onError}
        photo={photo}
        bursts={bursts}
        marked={marked}
        edits={edits}
        luts={luts}
        onLutsChanged={onLutsChanged}
        onExport={onExport}
      />
      <ScoresPanel photo={photo} />
      <SettingsPanel sessionId={sessionId} onApplied={onApplied} onError={onError} />
      <ShortcutsHelp />
    </aside>
  );
}
