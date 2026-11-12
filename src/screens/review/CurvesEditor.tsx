import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { Button } from "../../components/Button.tsx";
import {
  addPoint,
  movePoint,
  type Point,
  removePoint,
  tidy,
  withEnds,
} from "../../lib/curvePoints.ts";
import { cx } from "../../lib/cx.ts";
import { CURVE_CHANNELS, type CurveChannel, type Curves } from "../../lib/engine.ts";
import styles from "./CurvesEditor.module.css";

const SIZE = 200;
const NAMES: Record<CurveChannel, string> = {
  master: "Maestra",
  r: "Rojo",
  g: "Verde",
  b: "Azul",
};

type Props = {
  curves: Curves;
  disabled: boolean;
  onChange: (curves: Curves) => void;
};

const toX = (x: number) => x * SIZE;
const toY = (y: number) => (1 - y) * SIZE;

/** A smooth path through the points (Catmull-Rom turned into Béziers, for the drawing only). */
function curvePath(points: Point[]): string {
  const at = (i: number): Point => points[Math.max(0, Math.min(points.length - 1, i))] ?? [0, 0];
  let d = `M ${toX(at(0)[0])} ${toY(at(0)[1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${toX(c1[0])} ${toY(c1[1])}, ${toX(c2[0])} ${toY(c2[1])}, ${toX(p2[0])} ${toY(p2[1])}`;
  }
  return d;
}

/** Tone curves: click the line to add a point, drag it, or use the arrow keys; Supr removes it. */
export function CurvesEditor({ curves, disabled, onChange }: Props) {
  const [channel, setChannel] = useState<CurveChannel>("master");
  const [grabbed, setGrabbed] = useState<number | null>(null);
  const box = useRef<SVGSVGElement>(null);
  const points = withEnds(curves[channel]);
  const name = NAMES[channel];

  function set(next: Point[]) {
    onChange({ ...curves, [channel]: tidy(next) });
  }

  function where(event: PointerEvent): Point {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return [0, 0];
    return [(event.clientX - rect.left) / rect.width, 1 - (event.clientY - rect.top) / rect.height];
  }

  function add(event: PointerEvent<SVGSVGElement>) {
    if (disabled || event.target !== event.currentTarget) return;
    const [x, y] = where(event);
    const next = addPoint(curves[channel], x, y);
    onChange({ ...curves, [channel]: next });
    setGrabbed(next.findIndex(([px]) => Math.abs(px - x) < 0.0011));
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function drag(event: PointerEvent<SVGSVGElement>) {
    if (grabbed === null || disabled) return;
    const [x, y] = where(event);
    onChange({ ...curves, [channel]: movePoint(curves[channel], grabbed, x, y) });
  }

  function key(event: KeyboardEvent, index: number) {
    const point = points[index];
    if (!point || disabled) return;
    const step = event.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      set(movePoint(curves[channel], index, point[0] + move[0], point[1] + move[1]));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      set(removePoint(curves[channel], index));
    }
  }

  const touched = CURVE_CHANNELS.some((id) => curves[id].length >= 2);

  return (
    <div className={styles.root}>
      <div role="toolbar" aria-label="Canal de la curva" className={styles.tabs}>
        {CURVE_CHANNELS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={channel === id}
            className={cx(styles.tab, channel === id && styles.on)}
            onClick={() => setChannel(id)}
          >
            {NAMES[id]}
          </button>
        ))}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: an SVG drawing cannot be a fieldset */}
      <svg
        ref={box}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="group"
        aria-label={`Curva ${name}`}
        className={styles.graph}
        onPointerDown={add}
        onPointerMove={drag}
        onPointerUp={() => setGrabbed(null)}
        onPointerCancel={() => setGrabbed(null)}
      >
        {[1, 2, 3].map((n) => (
          <g key={n} className={styles.grid}>
            <line x1={(SIZE * n) / 4} y1={0} x2={(SIZE * n) / 4} y2={SIZE} />
            <line x1={0} y1={(SIZE * n) / 4} x2={SIZE} y2={(SIZE * n) / 4} />
          </g>
        ))}
        <line x1={0} y1={SIZE} x2={SIZE} y2={0} className={styles.diagonal} />
        <path d={curvePath(points)} className={cx(styles.line, styles[channel])} />
        {points.map(([x, y], index) => (
          // biome-ignore lint/a11y/useSemanticElements: an SVG point cannot be a <button>
          <circle
            // biome-ignore lint/suspicious/noArrayIndexKey: the points are positional and kept sorted
            key={index}
            cx={toX(x)}
            cy={toY(y)}
            r={6}
            tabIndex={disabled ? -1 : 0}
            role="button"
            aria-label={`Punto ${index + 1} de la curva ${name}: entrada ${Math.round(x * 100)}, salida ${Math.round(y * 100)}`}
            className={cx(styles.point, styles[channel])}
            onPointerDown={(event) => {
              event.stopPropagation();
              if (disabled) return;
              setGrabbed(index);
              box.current?.setPointerCapture?.(event.pointerId);
            }}
            onDoubleClick={() => !disabled && set(removePoint(curves[channel], index))}
            onKeyDown={(event) => key(event, index)}
          />
        ))}
      </svg>
      <p className={styles.hint}>Clic en la línea: agrega un punto. Doble clic o Supr: lo quita.</p>
      <Button
        size="sm"
        disabled={disabled || !touched}
        onClick={() => onChange({ master: [], r: [], g: [], b: [] })}
      >
        Restablecer curvas
      </Button>
    </div>
  );
}
