import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Skeleton } from "../../components/Skeleton.tsx";
import { cx } from "../../lib/cx.ts";
import { fileName, type SelectedPhoto } from "../../lib/engine.ts";
import { type Tier, usePreview } from "../../lib/previews.ts";
import {
  actualPixelsZoom,
  FIT_VIEW,
  maxZoom,
  panView,
  type Size,
  toTransform,
  type View,
  zoomTo,
  zoomView,
} from "../../lib/zoom.ts";
import styles from "./ZoomPane.module.css";

export type ZoomPaneHandle = { zoomBy: (factor: number) => void; toggle: () => void };

type Props = {
  photo: SelectedPhoto;
  view: View;
  onView: (view: View) => void;
  /** Ask a RAW for its half-size demosaic instead of the camera's embedded preview. */
  develop: boolean;
  label?: string;
  /** Only one pane answers the keyboard, so two panes in compare mode do not zoom twice. */
  primary?: boolean;
  handleRef?: Ref<ZoomPaneHandle>;
  onPercent?: (percent: number) => void;
};

const STEP = 1.4;
const PAN_STEP = 80;

/** One photo you can zoom with the wheel, drag, and double-click to jump to 100 %. */
export function ZoomPane({
  photo,
  view,
  onView,
  develop,
  label,
  primary,
  handleRef,
  onPercent,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [pane, setPane] = useState<Size>({ w: 800, h: 600 });
  const [dragging, setDragging] = useState(false);
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;

  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setPane({ w: rect.width, h: rect.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Sizes: the 1600 px view always; more detail only once the zoom needs it, or when asked for.
  const base = usePreview(photo.id, "view", 0);
  const baseGeom = base.image && { w: base.image.sourceWidth, h: base.image.sourceHeight };
  const baseScale = baseGeom ? toTransform(view, pane, baseGeom).scale : 0;
  const needsDetail =
    !!base.image && !!baseGeom && baseScale * dpr > base.image.width / baseGeom.w + 0.001;
  const developing = develop && photo.format === "raw";
  const detailTier: Tier = developing ? "develop" : "full";
  const detail = usePreview(developing || needsDetail ? photo.id : undefined, detailTier, 0);
  const sharp = detail.image;
  const geom = (sharp ?? base.image) && {
    w: (sharp ?? base.image)?.sourceWidth ?? 1,
    h: (sharp ?? base.image)?.sourceHeight ?? 1,
  };
  const t = geom ? toTransform(view, pane, geom) : undefined;
  const limit = geom ? maxZoom(pane, geom, dpr) : 1;
  const percent = t ? Math.round(t.scale * dpr * 100) : 100;

  useEffect(() => {
    onPercent?.(percent);
  }, [percent, onPercent]);

  const at = useCallback((clientX: number, clientY: number) => {
    const rect = box.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  const centre = { x: pane.w / 2, y: pane.h / 2 };
  const toggle = () => {
    if (!geom) return;
    onView(
      view.zoom > 1.01
        ? FIT_VIEW
        : zoomTo(view, pane, geom, actualPixelsZoom(pane, geom, dpr), centre, limit),
    );
  };
  const zoomBy = (factor: number) => {
    if (geom) onView(zoomView(view, pane, geom, factor, centre, limit));
  };

  useImperativeHandle(handleRef, () => ({ zoomBy, toggle }));

  // Latest values for the keyboard listener, which is registered once.
  const latest = useRef({ view, pane, geom, limit, toggle, zoomBy });
  latest.current = { view, pane, geom, limit, toggle, zoomBy };

  useEffect(() => {
    if (!primary) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (target?.closest("input, select, textarea, [contenteditable]")) return;
      const { view: v, pane: p, geom: g, toggle: flip, zoomBy: by } = latest.current;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [PAN_STEP, 0],
        ArrowRight: [-PAN_STEP, 0],
        ArrowUp: [0, PAN_STEP],
        ArrowDown: [0, -PAN_STEP],
      };
      if (event.shiftKey && arrows[event.key] && g) {
        event.preventDefault();
        const [dx, dy] = arrows[event.key] ?? [0, 0];
        onView(panView(v, p, g, dx, dy));
      } else if (event.key === "z" || event.key === "Z") {
        event.preventDefault();
        flip();
      } else if (event.key === "+" || event.key === "=") {
        by(STEP);
      } else if (event.key === "-") {
        by(1 / STEP);
      } else if (event.key === "0") {
        onView(FIT_VIEW);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [primary, onView]);

  const name = fileName(photo.path);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: wheel, drag and double-click are shortcuts; the toolbar buttons and the Z, +, - and 0 keys do the same.
    <div
      ref={box}
      className={cx(styles.pane, view.zoom > 1.01 && styles.zoomed, dragging && styles.dragging)}
      onWheel={(event) => {
        if (geom) {
          const point = at(event.clientX, event.clientY);
          onView(zoomView(view, pane, geom, Math.exp(-event.deltaY * 0.0015), point, limit));
        }
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || !geom) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (!drag.current || !geom) return;
        const dx = event.clientX - drag.current.x;
        const dy = event.clientY - drag.current.y;
        drag.current = { x: event.clientX, y: event.clientY };
        onView(panView(view, pane, geom, dx, dy));
      }}
      onPointerUp={() => {
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onDoubleClick={(event) => {
        if (!geom) return;
        const point = at(event.clientX, event.clientY);
        onView(
          view.zoom > 1.01
            ? FIT_VIEW
            : zoomTo(view, pane, geom, actualPixelsZoom(pane, geom, dpr), point, limit),
        );
      }}
    >
      {base.image && baseGeom && t ? (
        <img
          key={photo.id}
          src={base.image.url}
          alt={`Foto ${name}`}
          draggable={false}
          className={styles.image}
          style={{
            width: (geom?.w ?? baseGeom.w) * t.scale,
            height: (geom?.h ?? baseGeom.h) * t.scale,
            transform: `translate(${t.x}px, ${t.y}px)`,
          }}
        />
      ) : (
        <Skeleton className={styles.waiting} />
      )}
      {sharp && t && geom ? (
        <img
          src={sharp.url}
          alt=""
          draggable={false}
          className={styles.detail}
          style={{
            width: geom.w * t.scale,
            height: geom.h * t.scale,
            transform: `translate(${t.x}px, ${t.y}px)`,
          }}
        />
      ) : null}
      {label ? <span className={styles.label}>{label}</span> : null}
    </div>
  );
}
