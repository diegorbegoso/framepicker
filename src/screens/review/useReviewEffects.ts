import { useEffect } from "react";
import { getSettings } from "../../lib/engine.ts";
import { previews, setViewLut } from "../../lib/previews.ts";
import { setFullscreen } from "../../lib/window.ts";

type Input = {
  immersive: boolean;
  active: boolean;
  previousId: string | undefined;
  nextId: string | undefined;
};

/** Full screen follows the immersive mode, neighbours are warmed, and the previews are freed on exit. */
export function useReviewEffects({ immersive, active, previousId, nextId }: Input) {
  useEffect(() => {
    void setFullscreen(immersive && active);
  }, [immersive, active]);
  useEffect(
    () => () => {
      void setFullscreen(false);
      previews.clear();
    },
    [],
  );
  // The LUT the person last chose for viewing stays on between runs.
  useEffect(() => {
    void (async () => {
      try {
        const stored = await getSettings();
        setViewLut(stored?.view_lut ?? null);
      } catch {
        // Without the engine (tests, browser preview) the photos simply show as shot.
      }
    })();
  }, []);
  useEffect(() => {
    for (const id of [previousId, nextId]) {
      if (id) void previews.request(id, "view", 1).catch(() => undefined);
    }
  }, [previousId, nextId]);
}
