import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/Button.tsx";
import { Dialog } from "../../../components/Dialog.tsx";
import type { Adjustments } from "../../../lib/engine.ts";
import * as engine from "../../../lib/engine.ts";
import {
  type Crop,
  canvasSize,
  FULL,
  fitCrop,
  fractionRatio,
  isFull,
  outputSize,
  ratioOf,
  turnAspect,
} from "../../../lib/geometry.ts";
import { CropBar } from "./CropBar.tsx";
import styles from "./CropEditor.module.css";
import { CropStage } from "./CropStage.tsx";

export type Geometry = Pick<Adjustments, "rotate" | "flip" | "angle" | "crop" | "aspect">;

type Props = {
  photoId: string;
  /** The photo's corrections: the picture is shown with them, but uncut. */
  current: Adjustments;
  onApply: (geometry: Geometry) => void;
  onClose: () => void;
};

type Base = {
  url: string;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
};

/** Straighten and crop one photo over the uncut picture, with optional proportions. */
export function CropEditor({ photoId, current, onApply, onClose }: Props) {
  const [base, setBase] = useState<Base | null>(null);
  const [failed, setFailed] = useState(false);
  const [rotate, setRotate] = useState(current.rotate);
  const [flip, setFlip] = useState(current.flip);
  const [angle, setAngle] = useState(current.angle);
  const [crop, setCrop] = useState<Crop>(current.crop ?? FULL);
  const [aspect, setAspect] = useState<string | null>(current.aspect);
  const [note, setNote] = useState("");

  const latest = useRef(current);
  latest.current = current;

  useEffect(() => {
    let live = true;
    const uncut = { ...latest.current, rotate: 0, flip: false, angle: 0, crop: null, aspect: null };
    engine
      .preview(photoId, { maxPx: 1600, adjustments: uncut })
      .then((image) => live && setBase({ ...image }))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [photoId]);

  const odd = rotate % 2 === 1;
  const shownW = base ? (odd ? base.height : base.width) : 3;
  const shownH = base ? (odd ? base.width : base.height) : 2;
  const canvas = canvasSize(shownW, shownH, angle);
  const pixelRatio = ratioOf(aspect, shownW, shownH);
  const ratio = pixelRatio === null ? null : fractionRatio(pixelRatio, canvas);

  function choose(next: string | null) {
    setAspect(next);
    const wanted = ratioOf(next, shownW, shownH);
    if (wanted !== null) setCrop((now) => fitCrop(now, fractionRatio(wanted, canvas)));
  }

  function turn(direction: 1 | -1) {
    setRotate((now) => (now + direction + 4) % 4);
    setCrop(FULL);
    setAspect((now) => turnAspect(now, shownW, shownH));
  }

  function mirror() {
    setFlip((now) => !now);
    setCrop(([x0, y0, x1, y1]) => [1 - x1, y0, 1 - x0, y1]);
  }

  async function straighten() {
    setNote("");
    try {
      const found = await engine.straightenSuggest(photoId);
      if (found.found) setAngle(found.angle);
      else setNote("No encuentro un horizonte claro: endereza a mano.");
    } catch {
      setNote("No se pudo calcular el enderezado.");
    }
  }

  function reset() {
    setRotate(0);
    setFlip(false);
    setAngle(0);
    setCrop(FULL);
    setAspect(null);
    setNote("");
  }

  function apply() {
    const cut = isFull(crop) ? null : crop;
    onApply({ rotate, flip, angle, crop: cut, aspect: cut ? aspect : null });
  }

  const sourceW = base ? (odd ? base.sourceHeight : base.sourceWidth) : 0;
  const sourceH = base ? (odd ? base.sourceWidth : base.sourceHeight) : 0;
  const [outW, outH] = outputSize(sourceW, sourceH, angle, isFull(crop) ? null : crop);

  return (
    <Dialog title="Recortar y enderezar" wide onClose={onClose}>
      <div className={styles.layout}>
        <div className={styles.picture}>
          {base ? (
            <CropStage
              url={base.url}
              width={base.width}
              height={base.height}
              rotate={rotate}
              flip={flip}
              angle={angle}
              crop={crop}
              ratio={ratio}
              onCrop={setCrop}
            />
          ) : (
            <p role={failed ? "alert" : "status"} className={styles.loading}>
              {failed ? "No se pudo cargar la foto." : "Cargando la foto…"}
            </p>
          )}
        </div>
        <CropBar
          aspect={aspect}
          angle={angle}
          disabled={!base}
          onAspect={choose}
          onTurnAspect={() => choose(turnAspect(aspect, shownW, shownH))}
          onAngle={setAngle}
          onTurn={turn}
          onFlip={mirror}
          onAuto={() => void straighten()}
          onReset={reset}
        />
      </div>
      <p role="status" className={styles.note}>
        {note}
      </p>
      <div className={styles.footer}>
        <span className={styles.size}>{base ? `${outW} × ${outH} px` : ""}</span>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={!base} onClick={apply}>
          Aplicar
        </Button>
      </div>
    </Dialog>
  );
}
