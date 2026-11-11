import type { Dispatch, SetStateAction } from "react";
import type { SelectedBurst } from "../../lib/engine.ts";
import * as engine from "../../lib/engine.ts";
import { isReviewed } from "./BurstList.tsx";

type Input = {
  burst: SelectedBurst | undefined;
  bursts: SelectedBurst[];
  setBursts: Dispatch<SetStateAction<SelectedBurst[]>>;
  selectBurst: (id: string) => void;
  setError: (message: string | null) => void;
  announce: (message: string) => void;
};

/** "Confirmar ráfaga": mark the burst as reviewed, keep its picks, and move on to the next one. */
export function useConfirm({ burst, bursts, setBursts, selectBurst, setError, announce }: Input) {
  return async function confirm() {
    if (!burst || isReviewed(burst)) return;
    try {
      await engine.confirmBurst(burst.id);
    } catch {
      setError("No se pudo confirmar la ráfaga.");
      return;
    }
    setError(null);
    setBursts((all) =>
      all.map((b) =>
        b.id === burst.id
          ? { ...b, photos: b.photos.map((p) => ({ ...p, source: "user" as const })) }
          : b,
      ),
    );
    announce(`Ráfaga ${burst.position + 1} confirmada`);
    const after = bursts.slice(bursts.findIndex((b) => b.id === burst.id) + 1);
    const next =
      after.find((b) => !isReviewed(b)) ?? bursts.find((b) => b.id !== burst.id && !isReviewed(b));
    if (next) selectBurst(next.id);
  };
}
