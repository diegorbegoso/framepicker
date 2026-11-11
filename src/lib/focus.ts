import type { SelectedPhoto } from "./engine.ts";

/** Where a burst should open: on the photo that was picked, or on the first one when none was. */
export function firstPickedIndex(photos: SelectedPhoto[]): number {
  const at = photos.findIndex((photo) => photo.selected);
  return Math.max(at, 0);
}
