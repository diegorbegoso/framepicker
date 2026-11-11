import { useRef, useState } from "react";
import { Badge } from "../../components/Badge.tsx";
import { Button } from "../../components/Button.tsx";
import { IconButton } from "../../components/IconButton.tsx";
import { cx } from "../../lib/cx.ts";
import { fileName, type SelectedPhoto } from "../../lib/engine.ts";
import { FIT_VIEW, type View } from "../../lib/zoom.ts";
import styles from "./PhotoViewer.module.css";
import { ZoomPane, type ZoomPaneHandle } from "./ZoomPane.tsx";

type Props = {
  photo: SelectedPhoto | undefined;
  index: number;
  count: number;
  /** The photo shown on the left in compare mode. */
  reference: SelectedPhoto | undefined;
  compare: boolean;
  immersive: boolean;
  panelOpen: boolean;
  reviewed: boolean;
  /** False while the review is hidden behind another screen: the zoom keys are then ignored. */
  active: boolean;
  onToggle: (photo: SelectedPhoto) => void;
  onConfirm: () => void;
  onCompare: () => void;
  onPin: () => void;
  onImmersive: () => void;
  onPanel: () => void;
};

const STEP = 1.4;
const percent = (value: number) => `${Math.round(value * 100)} %`;

/** The dark stage: the focused photo large, with a floating toolbar and its scores on top. */
export function PhotoViewer({
  photo,
  index,
  count,
  reference,
  compare,
  immersive,
  panelOpen,
  reviewed,
  active,
  onToggle,
  onConfirm,
  onCompare,
  onPin,
  onImmersive,
  onPanel,
}: Props) {
  // Both panes share the same view, so comparing means looking at the same spot of each photo.
  const [view, setView] = useState<View>(FIT_VIEW);
  const [develop, setDevelop] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const handle = useRef<ZoomPaneHandle>(null);

  if (!photo) {
    return (
      <div className={styles.root}>
        <p className={styles.empty}>Esta ráfaga no tiene fotos.</p>
      </div>
    );
  }

  const scores = photo.scores;
  const isRaw = photo.format === "raw";
  const eyes = scores.eyes_open === null ? "sin rostro" : percent(scores.eyes_open);

  return (
    <div className={cx(styles.root, compare && styles.compare)}>
      <div className={styles.panes}>
        {compare && reference ? (
          <ZoomPane
            photo={reference}
            view={view}
            onView={setView}
            develop={develop}
            label="Referencia"
          />
        ) : null}
        <ZoomPane
          photo={photo}
          view={view}
          onView={setView}
          develop={develop}
          primary={active}
          handleRef={handle}
          onPercent={setZoomPercent}
          label={compare ? "Esta foto" : undefined}
        />
      </div>

      <div className={styles.toolbar}>
        <div className={styles.info}>
          <span className={styles.name}>{fileName(photo.path)}</span>
          <span className={styles.position}>
            {index + 1} de {count}
          </span>
        </div>
        <div className={styles.actions}>
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
            {zoomPercent} %
          </Button>
          <IconButton
            tone="stage"
            icon="zoom-in"
            label="Acercar"
            shortcut="+"
            onClick={() => handle.current?.zoomBy(STEP)}
          />
          <span className={styles.divider} aria-hidden="true" />
          {compare ? (
            <Button variant="stage" size="sm" onClick={onPin}>
              Fijar como referencia
            </Button>
          ) : null}
          <IconButton
            tone="stage"
            icon="columns"
            label="Comparar"
            shortcut="C"
            pressed={compare}
            onClick={onCompare}
          />
          {isRaw ? (
            <IconButton
              tone="stage"
              icon="sparkle"
              label="Alta resolución"
              pressed={develop}
              onClick={() => setDevelop((on) => !on)}
            />
          ) : null}
          <IconButton
            tone="stage"
            icon={immersive ? "minimize" : "maximize"}
            label={immersive ? "Salir de pantalla completa" : "Pantalla completa"}
            shortcut="F"
            onClick={onImmersive}
          />
          <IconButton
            tone="stage"
            icon="panel-right"
            label="Panel lateral"
            pressed={panelOpen}
            onClick={onPanel}
          />
        </div>
      </div>

      <div className={styles.hud}>
        <Badge tone="stage">Nitidez {percent(scores.sharpness_norm)}</Badge>
        <Badge tone="stage">Exposición {percent(scores.exposure)}</Badge>
        <Badge tone="stage">Ojos {eyes}</Badge>
      </div>

      <div className={styles.decide}>
        <Button
          variant={photo.selected ? "stage" : "primary"}
          icon={photo.selected ? "check" : undefined}
          aria-keyshortcuts="Space"
          onClick={() => onToggle(photo)}
        >
          {photo.selected ? "Quitar elección" : "Elegir esta foto"}
        </Button>
        <Button
          variant="stage"
          icon="circle-check"
          aria-keyshortcuts="Enter"
          disabled={reviewed}
          onClick={onConfirm}
        >
          {reviewed ? "Ráfaga revisada" : "Confirmar ráfaga"}
        </Button>
      </div>
    </div>
  );
}
