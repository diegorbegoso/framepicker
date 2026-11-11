import { useCallback, useEffect, useState } from "react";
import * as engine from "../../lib/engine.ts";
import { type Adjustments, isNeutral, NEUTRAL } from "../../lib/engine.ts";
import { previews } from "../../lib/previews.ts";

export type Edits = {
  /** The corrections of a photo; neutral when it has none. */
  of: (photoId: string | undefined) => Adjustments;
  edited: ReadonlySet<string>;
  /** Stores the same corrections on those photos, showing them at once. */
  apply: (photoIds: string[], adjustments: Adjustments) => Promise<void>;
  reset: (photoIds: string[]) => Promise<void>;
};

/**
 * The corrections of every photo in the session. Changes show at once and are saved in the
 * background; if saving fails the photos go back to how they were and `onError` says so.
 */
export function useEdits(sessionId: string, onError: (message: string | null) => void): Edits {
  const [stored, setStored] = useState<Record<string, Adjustments>>({});

  useEffect(() => {
    let current = true;
    engine
      .getEdits(sessionId)
      .then((found) => current && setStored(found))
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [sessionId]);

  const change = useCallback(
    async (photoIds: string[], next: Adjustments | null) => {
      if (photoIds.length === 0) return;
      const before = stored;
      const patch = (base: Record<string, Adjustments>) => {
        const copy = { ...base };
        for (const id of photoIds) {
          if (next === null || isNeutral(next)) delete copy[id];
          else copy[id] = next;
        }
        return copy;
      };
      setStored(patch);
      previews.invalidate(photoIds);
      try {
        if (next === null) await engine.resetEdits(sessionId, photoIds);
        else await engine.setEdits(sessionId, photoIds, next);
        onError(null);
      } catch {
        setStored(before);
        previews.invalidate(photoIds);
        onError("No se pudieron guardar las correcciones.");
      }
    },
    [sessionId, stored, onError],
  );

  return {
    of: (photoId) => (photoId ? (stored[photoId] ?? NEUTRAL) : NEUTRAL),
    edited: new Set(Object.keys(stored)),
    apply: (photoIds, adjustments) => change(photoIds, adjustments),
    reset: (photoIds) => change(photoIds, null),
  };
}
