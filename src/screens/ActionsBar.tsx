import { useEffect, useState } from "react";
import { Button } from "../components/Button.tsx";
import styles from "./ActionsBar.module.css";
import { ExportDialog } from "./dialogs/ExportDialog.tsx";
import { LutDialog } from "./dialogs/LutDialog.tsx";
import { OrganizeDialog } from "./dialogs/OrganizeDialog.tsx";
import type { Scope, ScopeIds } from "./review/scopes.ts";

type Dialog = "luts" | "export" | "organize";

/** A request, from elsewhere on the screen, to export a group of photos. `id` makes each one new. */
export type ExportRequest = { id: number; scope: Scope };

type Props = {
  sessionId: string;
  scopes: ScopeIds;
  exportRequest: ExportRequest | null;
  /** Called after a LUT is added or removed. */
  onLutsChanged: () => void;
  /** Tells the review a window is open, so the keyboard shortcuts stand down. */
  onBusy: (busy: boolean) => void;
};

/** The review's main functions, each one opening its own window. */
export function ActionsBar({ sessionId, scopes, exportRequest, onLutsChanged, onBusy }: Props) {
  const [open, setOpen] = useState<Dialog | null>(null);
  const [scope, setScope] = useState<Scope>("picked");
  const [handled, setHandled] = useState(exportRequest?.id ?? 0);
  // The last organisation, kept so it can still be undone after the window is closed.
  const [lastBatch, setLastBatch] = useState<string | null>(null);

  // A request from the corrections panel opens the export window on its own choice of photos.
  if (exportRequest && exportRequest.id !== handled) {
    setHandled(exportRequest.id);
    setScope(exportRequest.scope);
    setOpen("export");
  }

  useEffect(() => {
    onBusy(open !== null);
    return () => onBusy(false);
  }, [open, onBusy]);

  return (
    <div className={styles.root}>
      <Button
        size="sm"
        variant="primary"
        icon="download"
        onClick={() => {
          setScope("picked");
          setOpen("export");
        }}
      >
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
          scopes={scopes}
          initialScope={scope}
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
      {open === "luts" ? (
        <LutDialog onChanged={onLutsChanged} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}
