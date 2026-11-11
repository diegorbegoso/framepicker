import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { IconButton } from "../../components/IconButton.tsx";
import { fileName } from "../../lib/engine.ts";
import { FIT_VIEW, type View } from "../../lib/zoom.ts";
import { ZoomPane, type ZoomPaneHandle } from "../review/ZoomPane.tsx";
import type { GridItem } from "./items.ts";
import styles from "./ViewerModal.module.css";

type Props = {
  item: GridItem;
  index: number;
  count: number;
  onClose: () => void;
  onStep: (delta: number) => void;
  onPick: () => void;
};

const STEP = 1.4;
const FOCUSABLE = "button:not([disabled]), [href], input, select, [tabindex]:not([tabindex='-1'])";

/** The photo large, over the grid: zoom to check details, move along the grid, pick or drop it. */
export function ViewerModal({ item, index, count, onClose, onStep, onPick }: Props) {
  const { photo } = item;
  const root = useRef<HTMLDivElement>(null);
  const handle = useRef<ZoomPaneHandle>(null);
  const [view, setView] = useState<View>(FIT_VIEW);
  const [develop, setDevelop] = useState(false);
  const [percent, setPercent] = useState(100);
  const latest = useRef({ onClose, onStep, onPick });
  latest.current = { onClose, onStep, onPick };

  // A new photo opens fitted, not at the previous photo's zoom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the photo id is the trigger.
  useEffect(() => setView(FIT_VIEW), [photo.id]);

  // Focus goes into the dialog and comes back to where it was when it closes.
  useEffect(() => {
    const before = document.activeElement;
    root.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      if (before instanceof HTMLElement) before.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const a = latest.current;
      if (event.key === "Escape") {
        event.preventDefault();
        a.onClose();
      } else if (event.key === "Tab") {
        const nodes = [...(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.shiftKey) {
        event.preventDefault();
        a.onStep(event.key === "ArrowRight" ? 1 : -1);
      } else if (event.key === " " && !(event.target as Element).closest?.("button")) {
        event.preventDefault();
        a.onPick();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={styles.backdrop}>
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={`Ampliar ${fileName(photo.path)}`}
        className={styles.dialog}
      >
        <div className={styles.stage}>
          <ZoomPane
            photo={photo}
            view={view}
            onView={setView}
            develop={develop}
            primary
            handleRef={handle}
            onPercent={setPercent}
          />
        </div>
        <div className={styles.bar}>
          <span className={styles.name}>{fileName(photo.path)}</span>
          <span className={styles.position}>
            {index + 1} de {count}
          </span>
          <IconButton
            tone="stage"
            icon="zoom-out"
            label="Alejar"
            shortcut="-"
            onClick={() => handle.current?.zoomBy(1 / STEP)}
          />
          <Button
            variant="stage"
            size="sm"
            aria-label="Alternar entre ajustar y 100 %"
            aria-keyshortcuts="Z"
            onClick={() => handle.current?.toggle()}
          >
            {percent} %
          </Button>
          <IconButton
            tone="stage"
            icon="zoom-in"
            label="Acercar"
            shortcut="+"
            onClick={() => handle.current?.zoomBy(STEP)}
          />
          {photo.format === "raw" ? (
            <IconButton
              tone="stage"
              icon="sparkle"
              label="Alta resolución"
              pressed={develop}
              onClick={() => setDevelop((on) => !on)}
            />
          ) : null}
          <Button
            variant={photo.selected ? "stage" : "primary"}
            size="sm"
            icon={photo.selected ? "check" : undefined}
            aria-keyshortcuts="Space"
            onClick={onPick}
          >
            {photo.selected ? "Quitar elección" : "Elegir esta foto"}
          </Button>
          <IconButton tone="stage" icon="x" label="Cerrar" shortcut="Esc" onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
