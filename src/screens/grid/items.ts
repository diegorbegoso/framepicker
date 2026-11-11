import type { SelectedBurst, SelectedPhoto } from "../../lib/engine.ts";

/** One cell of the grid: a photo with the burst it belongs to. */
export type GridItem = {
  burstId: string;
  /** 1-based number shown to the person. */
  burstNumber: number;
  photo: SelectedPhoto;
  /** First photo of its burst, where a new group starts. */
  first: boolean;
};

export type GridFilter = "all" | "picked" | "unpicked" | "low";

export function flatten(bursts: SelectedBurst[]): GridItem[] {
  return bursts.flatMap((burst) =>
    burst.photos.map((photo, index) => ({
      burstId: burst.id,
      burstNumber: burst.position + 1,
      photo,
      first: index === 0,
    })),
  );
}

export function matches(photo: SelectedPhoto, filter: GridFilter): boolean {
  if (filter === "picked") return photo.selected;
  if (filter === "unpicked") return !photo.selected;
  if (filter === "low") return photo.fails.length > 0;
  return true;
}

/** The items a filter shows. The first of each burst in the result opens its group. */
export function visibleItems(items: GridItem[], filter: GridFilter): GridItem[] {
  let previous: string | undefined;
  return items
    .filter((item) => matches(item.photo, filter))
    .map((item) => {
      const first = item.burstId !== previous;
      previous = item.burstId;
      return { ...item, first };
    });
}

/** Items between two positions, both included, whichever comes first. */
export function between<T>(list: T[], a: number, b: number): T[] {
  return list.slice(Math.min(a, b), Math.max(a, b) + 1);
}

export const FAIL_TEXT = { sharpness: "nitidez", exposure: "exposición", eyes: "ojos" } as const;
