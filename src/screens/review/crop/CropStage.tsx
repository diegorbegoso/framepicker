import { type KeyboardEvent, type PointerEvent, useLayoutEffect, useRef, useState } from "react";
import { type Crop, fitFactor, type Handle, moveCrop, resizeCrop } from "../../../lib/geometry.ts";
import styles from "./CropStage.module.css";

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_NAMES: Record<Handle, string> = {
  nw: "esquina superior izquierda",
  n: "lado superior",
  ne: "esquina superior derecha",
  e: "lado derecho",
  se: "esquina inferior derecha",
  s: "lado inferior",
  sw: "esquina inferior izquierda",
  w: "lado izquierdo",
};

type Props = {
  url: string;
  /** Size of the picture as it comes, before any turn. */
  width: number;
  height: number;
  rotate: number;
  flip: boolean;
  angle: number;
  crop: Crop;
  /** Width over height of the crop in canvas fractions, or null when it is free. */
  ratio: number | null;
  onCrop: (crop: Crop) => void;
};

type Drag = { kind: "move" | Handle; start: [number, number]; crop: Crop };

/** The picture, turned as chosen, with the cutting frame over the straightened canvas. */
export function CropStage({ url, width, height, rotate, flip, angle, crop, ratio, onCrop }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const odd = rotate % 2 === 1;
  const shownW = odd ? height : width; // the picture once quarter-turned
  const shownH = odd ? width : height;
  const k = fitFactor(shownW, shownH, angle);

  useLayoutEffect(() => {
    const node = stage.current;
    if (!node) return;
    const measure = () => setSize([node.clientWidth, node.clientHeight]);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watcher = new ResizeObserver(measure);
    watcher.observe(node);
    return () => watcher.disconnect();
  }, []);

  function at(event: PointerEvent): [number, number] {
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return [0, 0];
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
  }

  function grab(kind: Drag["kind"]) {
    return (event: PointerEvent) => {
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setDrag({ kind, start: at(event), crop });
    };
  }

  function move(event: PointerEvent) {
    if (!drag) return;
    const [x, y] = at(event);
    if (drag.kind === "move") {
      onCrop(moveCrop(drag.crop, x - drag.start[0], y - drag.start[1]));
    } else {
      onCrop(resizeCrop(drag.crop, drag.kind, x, y, ratio));
    }
  }

  function keys(event: KeyboardEvent) {
    const step = event.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = moves[event.key];
    if (!delta) return;
    event.preventDefault();
    onCrop(moveCrop(crop, delta[0], delta[1]));
  }

  const [w, h] = size;
  const imageW = odd ? h : w;
  const imageH = odd ? w : h;
  const transform = `translate(-50%, -50%) rotate(${angle}deg) scaleX(${flip ? -1 : 1}) rotate(${rotate * 90}deg)`;
  const pct = (n: number) => `${n * 100}%`;

  return (
    <div
      ref={stage}
      className={styles.stage}
      style={{ aspectRatio: `${shownW} / ${shownH}` }}
      data-testid="crop-stage"
    >
      <img
        src={url}
        alt="Foto que se recorta"
        draggable={false}
        className={styles.image}
        style={{ width: imageW, height: imageH, transform }}
      />
      <div
        ref={canvas}
        className={styles.canvas}
        style={{ left: pct((1 - k) / 2), top: pct((1 - k) / 2), width: pct(k), height: pct(k) }}
        onPointerMove={move}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: a draggable frame is not a fieldset */}
        <div
          role="group"
          aria-label="Recuadro de recorte"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the frame moves with the arrow keys
          tabIndex={0}
          className={styles.frame}
          style={{
            left: pct(crop[0]),
            top: pct(crop[1]),
            width: pct(crop[2] - crop[0]),
            height: pct(crop[3] - crop[1]),
          }}
          onPointerDown={grab("move")}
          onKeyDown={keys}
        >
          <span className={styles.thirds} aria-hidden="true" />
          {angle !== 0 ? <span className={styles.fine} aria-hidden="true" /> : null}
          {HANDLES.map((handle) => (
            <span
              key={handle}
              role="presentation"
              title={HANDLE_NAMES[handle]}
              data-handle={handle}
              className={`${styles.handle} ${styles[handle]}`}
              onPointerDown={grab(handle)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
