import { useEffect, useState } from "react";
import { Button } from "../components/Button.tsx";
import styles from "./ActionsBar.module.css";
import { LutDialog } from "./dialogs/LutDialog.tsx";

type Dialog = "luts";

type Props = {
  /** Tells the review a window is open, so the keyboard shortcuts stand down. */
  onBusy: (busy: boolean) => void;
};

/** The review's main functions, each one opening its own window. */
export function ActionsBar({ onBusy }: Props) {
  const [open, setOpen] = useState<Dialog | null>(null);

  useEffect(() => {
    onBusy(open !== null);
    return () => onBusy(false);
  }, [open, onBusy]);

  return (
    <div className={styles.root}>
      <Button size="sm" icon="sparkle" onClick={() => setOpen("luts")}>
        LUT…
      </Button>
      {open === "luts" ? <LutDialog onClose={() => setOpen(null)} /> : null}
    </div>
  );
}
