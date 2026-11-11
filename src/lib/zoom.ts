/**
 * Zoom and pan maths for the photo viewer, kept free of the DOM so it can be tested.
 *
 * A `View` is what stays the same when two panes show the same scene: `zoom` is relative to the
 * "fit" size (1 = the whole photo fits) and (`u`, `v`) is the point of the photo at the centre of
 * the pane, from 0 to 1. A `Transform` is that same view for one pane: display pixels per source
 * pixel and where the photo's top-left corner lands inside the pane.
 */

export type Size = { w: number; h: number };
export type View = { zoom: number; u: number; v: number };
export type Transform = { scale: number; x: number; y: number };

export const FIT_VIEW: View = { zoom: 1, u: 0.5, v: 0.5 };
export const MAX_ACTUAL_PIXELS = 4;

const safe = (value: number) => (value > 0 ? value : 1);

/** Display pixels per source pixel that make the whole photo fit the pane. */
export function fitScale(pane: Size, image: Size): number {
  return Math.min(safe(pane.w) / safe(image.w), safe(pane.h) / safe(image.h));
}

/** The zoom (relative to fit) at which one source pixel is one screen pixel. */
export function actualPixelsZoom(pane: Size, image: Size, devicePixelRatio = 1): number {
  return 1 / safe(devicePixelRatio) / fitScale(pane, image);
}

/** The most the viewer zooms in: four times actual pixels, and never less than twice fit. */
export function maxZoom(pane: Size, image: Size, devicePixelRatio = 1): number {
  return Math.max(2, actualPixelsZoom(pane, image, devicePixelRatio) * MAX_ACTUAL_PIXELS);
}

/** Keeps the photo covering the pane, or centred on an axis where it is smaller than the pane. */
export function clampTransform(t: Transform, pane: Size, image: Size): Transform {
  const shown = { w: image.w * t.scale, h: image.h * t.scale };
  const x =
    shown.w <= pane.w ? (pane.w - shown.w) / 2 : Math.min(0, Math.max(pane.w - shown.w, t.x));
  const y =
    shown.h <= pane.h ? (pane.h - shown.h) / 2 : Math.min(0, Math.max(pane.h - shown.h, t.y));
  return { scale: t.scale, x, y };
}

export function toTransform(view: View, pane: Size, image: Size): Transform {
  const scale = fitScale(pane, image) * view.zoom;
  const x = pane.w / 2 - view.u * image.w * scale;
  const y = pane.h / 2 - view.v * image.h * scale;
  return clampTransform({ scale, x, y }, pane, image);
}

export function fromTransform(t: Transform, pane: Size, image: Size): View {
  const zoom = t.scale / fitScale(pane, image);
  const u = (pane.w / 2 - t.x) / (image.w * t.scale);
  const v = (pane.h / 2 - t.y) / (image.h * t.scale);
  return { zoom, u, v };
}

/** Zooms by `factor` keeping the photo point under `at` (pane coordinates) where it is. */
export function zoomView(
  view: View,
  pane: Size,
  image: Size,
  factor: number,
  at: { x: number; y: number },
  maxZoomValue: number,
): View {
  const t = toTransform(view, pane, image);
  const nextZoom = Math.min(maxZoomValue, Math.max(1, view.zoom * factor));
  const scale = fitScale(pane, image) * nextZoom;
  const ratio = scale / t.scale;
  const moved = { scale, x: at.x - (at.x - t.x) * ratio, y: at.y - (at.y - t.y) * ratio };
  return fromTransform(clampTransform(moved, pane, image), pane, image);
}

/** Moves the photo by (dx, dy) display pixels, as when dragging it. */
export function panView(view: View, pane: Size, image: Size, dx: number, dy: number): View {
  const t = toTransform(view, pane, image);
  return fromTransform(
    clampTransform({ ...t, x: t.x + dx, y: t.y + dy }, pane, image),
    pane,
    image,
  );
}

/** Zooms to `target` centred on `at`, e.g. to jump to 100 % on the spot that was double-clicked. */
export function zoomTo(
  view: View,
  pane: Size,
  image: Size,
  target: number,
  at: { x: number; y: number },
  maxZoomValue: number,
): View {
  return zoomView(view, pane, image, target / view.zoom, at, maxZoomValue);
}
