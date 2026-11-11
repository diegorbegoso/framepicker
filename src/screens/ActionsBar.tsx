import { useEffect, useState } from "react";
import { Button } from "../components/Button.tsx";
import styles from "./ActionsBar.module.css";
import { ExportDialog } from "./dialogs/ExportDialog.tsx";
import { LutDialog } from "./dialogs/LutDialog.tsx";
import { OrganizeDialog } from "./dialogs/OrganizeDialog.tsx";

type Dialog = "luts" | "export" | "organize";

type Props = {
  sessionId: string;
  selectedCount: number;
  /** Tells the review a window is open, so the keyboard shortcuts stand down. */
  onBusy: (busy: boolean) => void;
};

/** The review's main functions, each one opening its own window. */
export function ActionsBar({ sessionId, selectedCount, onBusy }: Props) {
  const [open, setOpen] = useState<Dialog | null>(null);
  // The last organisation, kept so it can still be undone after the window is closed.
  const [lastBatch, setLastBatch] = useState<string | null>(null);

  useEffect(() => {
    onBusy(open !== null);
    return () => onBusy(false);
  }, [open, onBusy]);

  return (
    <div className={styles.root}>
      <Button size="sm" variant="primary" icon="download" onClick={() => setOpen("export")}>
        Exportar…
      </Button>
      <Button size="sm" icon="folder" onClick={() => setOpen("organize")}>
        Ordenar carpeta…
      </Button>
      <Button size="sm" icon="sparkle" onClick={() => setOpen("luts")}>
        LUT…
      </Button>
      {open === "export" ? (
        <ExportDialog
          sessionId={sessionId}
          selectedCount={selectedCount}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === "organize" ? (
        <OrganizeDialog
          sessionId={sessionId}
          batchId={lastBatch}
          onBatch={setLastBatch}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open === "luts" ? <LutDialog onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
