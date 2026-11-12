export type Point = [number, number];

export const MAX_POINTS = 12;
/** Smallest horizontal gap between two points; the engine refuses closer ones. */
export const MIN_GAP = 0.01;

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const round = (n: number) => Math.round(n * 1000) / 1000;

/** The points to draw: a curve nobody touched is the straight line from corner to corner. */
export function withEnds(points: Point[]): Point[] {
  return points.length >= 2
    ? points
    : [
        [0, 0],
        [1, 1],
      ];
}

export function isStraight(points: Point[]): boolean {
  return points.length < 2 || points.every(([x, y]) => Math.abs(x - y) < 1e-6);
}

/** What the engine stores: nothing for a straight line. */
export function tidy(points: Point[]): Point[] {
  return isStraight(points) ? [] : points;
}

/** Adds a point where the person clicked. The corners are kept so the curve always spans 0 to 1. */
export function addPoint(points: Point[], x: number, y: number): Point[] {
  const base = withEnds(points);
  if (base.length >= MAX_POINTS) return base;
  if (base.some(([px]) => Math.abs(px - x) < MIN_GAP)) return base;
  const next: Point[] = [...base, [round(clamp(x, 0, 1)), round(clamp(y, 0, 1))]];
  return next.sort((a, b) => a[0] - b[0]);
}

/** Moves one point, keeping it between its neighbours; the first and last only move up and down. */
export function movePoint(points: Point[], index: number, x: number, y: number): Point[] {
  const base = withEnds(points);
  const current = base[index];
  if (!current) return base;
  const first = index === 0;
  const last = index === base.length - 1;
  const left = first ? 0 : (base[index - 1]?.[0] ?? 0) + MIN_GAP;
  const right = last ? 1 : (base[index + 1]?.[0] ?? 1) - MIN_GAP;
  const nextX = first || last ? current[0] : clamp(x, left, right);
  return base.map((point, i) => (i === index ? [round(nextX), round(clamp(y, 0, 1))] : point));
}

/** Removes an inner point; the two ends stay. */
export function removePoint(points: Point[], index: number): Point[] {
  const base = withEnds(points);
  if (index <= 0 || index >= base.length - 1) return base;
  return base.filter((_, i) => i !== index);
}
