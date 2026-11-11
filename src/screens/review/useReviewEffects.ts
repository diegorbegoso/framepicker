import { useEffect } from "react";
import { previews } from "../../lib/previews.ts";
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
  useEffect(() => {
    for (const id of [previousId, nextId]) {
      if (id) void previews.request(id, "view", 1).catch(() => undefined);
    }
  }, [previousId, nextId]);
}
