import { type Adjustments, preview } from "./engine.ts";

const THUMB_PX = 140;
const KEEP = 400;
const PARALLEL = 3;

const cache = new Map<string, string>();
const waiting: (() => void)[] = [];
const inflight = new Map<string, Promise<string>>();
let running = 0;

/** What a thumbnail depends on: the photo, its other corrections and the LUT shown on it. */
function keyOf(photoId: string, adj: Adjustments, lutId: string | null): string {
  const { lut_id: _lut, lut_strength: _strength, ...rest } = adj;
  return `${photoId}|${lutId ?? "-"}|${JSON.stringify(rest)}`;
}

/** Already drawn thumbnails are shown at once, without asking the engine again. */
export function peekThumb(photoId: string, adj: Adjustments, lutId: string | null) {
  return cache.get(keyOf(photoId, adj, lutId));
}

function next() {
  while (running < PARALLEL) {
    const start = waiting.shift();
    if (!start) return;
    running += 1;
    start();
  }
}

/**
 * The photo as it would look with a LUT, small. A few are drawn at a time so a gallery of sixty
 * never floods the engine, and the last ones drawn are kept for when the drawer opens again.
 */
export function loadThumb(
  photoId: string,
  adj: Adjustments,
  lutId: string | null,
): Promise<string> {
  const key = keyOf(photoId, adj, lutId);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const same = inflight.get(key);
  if (same) return same;
  const request = new Promise<string>((resolve, reject) => {
    waiting.push(() => {
      preview(photoId, { maxPx: THUMB_PX, adjustments: { ...adj, lut_id: lutId, lut_strength: 1 } })
        .then((image) => {
          cache.set(key, image.url);
          while (cache.size > KEEP) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cache.delete(oldest);
          }
          resolve(image.url);
        })
        .catch(reject)
        .finally(() => {
          running -= 1;
          inflight.delete(key);
          next();
        });
    });
    next();
  });
  inflight.set(key, request);
  return request;
}

export function clearThumbs(): void {
  cache.clear();
  inflight.clear();
  waiting.length = 0;
}
