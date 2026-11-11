import type { Dispatch, SetStateAction } from "react";
import type { SelectedBurst, SelectedPhoto } from "../../lib/engine.ts";
import * as engine from "../../lib/engine.ts";

/** Choosing and dropping photos: shown at once, saved in the background, put back if it fails. */
export function usePicks(
  setBursts: Dispatch<SetStateAction<SelectedBurst[]>>,
  setError: (message: string | null) => void,
  announce: (message: string) => void,
) {
  function replacePhoto(burstId: string, photoId: string, patch: Partial<SelectedPhoto>) {
    setBursts((all) =>
      all.map((b) =>
        b.id !== burstId
          ? b
          : { ...b, photos: b.photos.map((p) => (p.id === photoId ? { ...p, ...patch } : p)) },
      ),
    );
  }

  async function setPick(burstId: string, photo: SelectedPhoto, next: boolean) {
    const name = engine.fileName(photo.path);
    replacePhoto(burstId, photo.id, { selected: next, source: "user" });
    announce(`${name}: ${next ? "elegida" : "no elegida"}`);
    try {
      await engine.setPick(burstId, photo.id, next);
      setError(null);
    } catch {
      replacePhoto(burstId, photo.id, { selected: photo.selected, source: photo.source });
      setError("No se pudo guardar la elección.");
    }
  }

  return { setPick };
}
