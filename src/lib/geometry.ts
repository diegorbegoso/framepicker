/** Straightening and cropping maths, the same formulas as `engine/mejores_engine/geometry.py`. */

export type Crop = [number, number, number, number];
export const FULL: Crop = [0, 0, 1, 1];
/** Smallest side of a crop, as a fraction of the straightened canvas. */
export const MIN_SIDE = 0.05;

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/** How much of the picture's size the straightened canvas keeps (1 when it is not turned). */
export function fitFactor(width: number, height: number, angle: number): number {
  const theta = (Math.abs(angle) * Math.PI) / 180;
  const longer = Math.max(width, height);
  const shorter = Math.min(width, height);
  return 1 / (Math.cos(theta) + (longer / shorter) * Math.sin(theta));
}

export function canvasSize(width: number, height: number, angle: number): [number, number] {
  const k = fitFactor(width, height, angle);
  return [width * k, height * k];
}

/** Size in pixels of what is left after straightening and cutting. */
export function outputSize(
  width: number,
  height: number,
  angle: number,
  crop: Crop | null,
): [number, number] {
  const [cw, ch] = canvasSize(width, height, angle);
  const [x0, y0, x1, y1] = crop ?? FULL;
  return [Math.max(1, Math.round((x1 - x0) * cw)), Math.max(1, Math.round((y1 - y0) * ch))];
}

export const isFull = (crop: Crop) =>
  crop[0] <= 0.001 && crop[1] <= 0.001 && crop[2] >= 0.999 && crop[3] >= 0.999;

/** The proportions on offer. "libre" has no fixed ratio and "original" follows the photo. */
export const ASPECTS = [
  { id: "libre", label: "Libre" },
  { id: "original", label: "Original" },
  { id: "1:1", label: "1:1" },
  { id: "4:5", label: "4:5" },
  { id: "3:2", label: "3:2" },
  { id: "16:9", label: "16:9" },
  { id: "9:16", label: "9:16" },
] as const;

/** Width over height in pixels for a proportion, or null when it is free. */
export function ratioOf(aspect: string | null, width: number, height: number): number | null {
  if (aspect === null || aspect === "libre") return null;
  if (aspect === "original") return width / height;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  if (!match) return null;
  const [w, h] = [Number(match[1]), Number(match[2])];
  return w > 0 && h > 0 ? w / h : null;
}

/** "3:2" ⇄ "2:3". Free and original have no orientation to flip; "original" becomes explicit. */
export function turnAspect(aspect: string | null, width: number, height: number): string | null {
  if (aspect === null || aspect === "libre") return aspect;
  const ratio = ratioOf(aspect, width, height);
  if (ratio === null) return aspect;
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  return match ? `${match[2]}:${match[1]}` : `${height}:${width}`;
}

/** The ratio of a crop's sides measured on the canvas (fractions), given the pixel ratio wanted. */
export const fractionRatio = (pixelRatio: number, canvas: [number, number]) =>
  (pixelRatio * canvas[1]) / canvas[0];

/** The biggest crop of the wanted shape that fits, centred where the current crop is. */
export function fitCrop(current: Crop, ratio: number): Crop {
  const cx = (current[0] + current[2]) / 2;
  const cy = (current[1] + current[3]) / 2;
  let w = current[2] - current[0];
  let h = current[3] - current[1];
  const area = w * h;
  h = Math.sqrt(area / ratio);
  w = h * ratio;
  const room = Math.min(1 / w, 1 / h, 1);
  w *= room;
  h *= room;
  const x0 = clamp(cx - w / 2, 0, 1 - w);
  const y0 = clamp(cy - h / 2, 0, 1 - h);
  return [x0, y0, x0 + w, y0 + h];
}

export function moveCrop(crop: Crop, dx: number, dy: number): Crop {
  const w = crop[2] - crop[0];
  const h = crop[3] - crop[1];
  const x0 = clamp(crop[0] + dx, 0, 1 - w);
  const y0 = clamp(crop[1] + dy, 0, 1 - h);
  return [x0, y0, x0 + w, y0 + h];
}

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/**
 * Moves one handle to the point (px, py) of the canvas. With a `ratio` (width over height, in
 * canvas fractions) the shape is kept and the opposite corner or side stays where it is.
 */
export function resizeCrop(
  crop: Crop,
  handle: Handle,
  px: number,
  py: number,
  ratio: number | null,
): Crop {
  const x = clamp(px, 0, 1);
  const y = clamp(py, 0, 1);
  let [x0, y0, x1, y1] = crop;
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  if (ratio === null) {
    if (west) x0 = Math.min(x, x1 - MIN_SIDE);
    if (east) x1 = Math.max(x, x0 + MIN_SIDE);
    if (north) y0 = Math.min(y, y1 - MIN_SIDE);
    if (south) y1 = Math.max(y, y0 + MIN_SIDE);
    return [x0, y0, x1, y1];
  }
  const corner = (west || east) && (north || south);
  if (corner) {
    const ax = west ? x1 : x0;
    const ay = north ? y1 : y0;
    let w = Math.abs(x - ax);
    let h = Math.abs(y - ay);
    if (w / ratio > h) h = w / ratio;
    else w = h * ratio;
    const roomX = west ? ax : 1 - ax;
    const roomY = north ? ay : 1 - ay;
    const fit = Math.min(1, roomX / w, roomY / h);
    w = Math.max(w * fit, MIN_SIDE);
    h = w / ratio;
    return west
      ? north
        ? [ax - w, ay - h, ax, ay]
        : [ax - w, ay, ax, ay + h]
      : north
        ? [ax, ay - h, ax + w, ay]
        : [ax, ay, ax + w, ay + h];
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (west || east) {
    const anchor = west ? x1 : x0;
    let w = Math.abs(x - anchor);
    const maxW = Math.min(west ? anchor : 1 - anchor, 2 * Math.min(cy, 1 - cy) * ratio);
    w = clamp(w, MIN_SIDE, Math.max(maxW, MIN_SIDE));
    const h = w / ratio;
    return west
      ? [anchor - w, cy - h / 2, anchor, cy + h / 2]
      : [anchor, cy - h / 2, anchor + w, cy + h / 2];
  }
  const anchor = north ? y1 : y0;
  let h = Math.abs(y - anchor);
  const maxH = Math.min(north ? anchor : 1 - anchor, (2 * Math.min(cx, 1 - cx)) / ratio);
  h = clamp(h, MIN_SIDE / ratio, Math.max(maxH, MIN_SIDE / ratio));
  const w = h * ratio;
  return north
    ? [cx - w / 2, anchor - h, cx + w / 2, anchor]
    : [cx - w / 2, anchor, cx + w / 2, anchor + h];
}
