import type { SelectedPhoto, SelectResult } from "../lib/engine.ts";

/** A photo of a burst as `select` reports it. RAW photos get an .ARW name. */
export function photo(
  id: string,
  selected: boolean,
  sharpnessNorm = 1,
  format: SelectedPhoto["format"] = "jpg",
  source: SelectedPhoto["source"] = "auto",
): SelectedPhoto {
  return {
    id,
    path: `C:\\fotos\\${id}.${format === "raw" ? "ARW" : "jpg"}`,
    format,
    scores: {
      sharpness: 100 * sharpnessNorm,
      sharpness_norm: sharpnessNorm,
      exposure: 0.9,
      eyes_open: null,
      combined: 0.8 * sharpnessNorm,
    },
    selected,
    source,
  };
}

/** Two bursts: three JPEGs with the second picked, then two RAWs with the first picked. */
export const RESULT: SelectResult = {
  bursts: [
    {
      id: "b1",
      position: 0,
      photos: [photo("IMG_1", false, 0.5), photo("IMG_2", true), photo("IMG_3", false, 0.2)],
    },
    {
      id: "b2",
      position: 1,
      photos: [photo("IMG_4", true, 1, "raw"), photo("IMG_5", false, 0.4, "raw")],
    },
  ],
};
