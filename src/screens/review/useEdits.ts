import { useCallback, useEffect, useRef, useState } from "react";
import * as engine from "../../lib/engine.ts";
import { type Adjustments, isNeutral, NEUTRAL } from "../../lib/engine.ts";
import { livePreview } from "../../lib/livePreview.ts";
import { previews } from "../../lib/previews.ts";

export type Edits = {
  /** The corrections of a photo; neutral when it has none. */
  of: (photoId: string | undefined) => Adjustments;
  edited: ReadonlySet<string>;
  /** Stores the same corrections on those photos, showing them at once. */
  apply: (photoIds: string[], adjustments: Adjustments) => Promise<void>;
  reset: (photoIds: string[]) => Promise<void>;
  /** Reads every photo's corrections again, e.g. after a job changed many of them. */
  reload: () => Promise<void>;
  /** What those photos have now (`null` for none), to be able to go back to it. */
  snapshot: (photoIds: string[]) => Record<string, Adjustments | null>;
  /** Gives each photo its own corrections, or none. */
  put: (entries: Record<string, Adjustments | null>) => Promise<void>;
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

  const latest = useRef(stored);
  latest.current = stored;

  const reload = useCallback(async () => {
    try {
      const found = await engine.getEdits(sessionId);
      // What a job changed behind our back: the photos whose corrections differ now show them.
      const old = latest.current;
      const changed = [...new Set([...Object.keys(old), ...Object.keys(found)])].filter(
        (id) => JSON.stringify(old[id]) !== JSON.stringify(found[id]),
      );
      setStored(found);
      if (changed.length > 0) {
        previews.invalidate(changed);
        for (const id of changed) livePreview.clear(id);
      }
    } catch {
      onError("No se pudieron leer las correcciones.");
    }
  }, [sessionId, onError]);

  const put = useCallback(
    async (entries: Record<string, Adjustments | null>) => {
      const before = stored;
      const ids = Object.keys(entries);
      setStored((base) => {
        const copy = { ...base };
        for (const [id, adjustments] of Object.entries(entries)) {
          if (adjustments === null || isNeutral(adjustments)) delete copy[id];
          else copy[id] = adjustments;
        }
        return copy;
      });
      previews.invalidate(ids);
      try {
        await engine.putEdits(sessionId, entries);
        onError(null);
      } catch {
        setStored(before);
        previews.invalidate(ids);
        onError("No se pudieron guardar las correcciones.");
      }
    },
    [sessionId, stored, onError],
  );

  return {
    reload,
    put,
    snapshot: (photoIds) => Object.fromEntries(photoIds.map((id) => [id, stored[id] ?? null])),
    of: (photoId) => (photoId ? (stored[photoId] ?? NEUTRAL) : NEUTRAL),
    edited: new Set(Object.keys(stored)),
    apply: (photoIds, adjustments) => change(photoIds, adjustments),
    reset: (photoIds) => change(photoIds, null),
  };
}
