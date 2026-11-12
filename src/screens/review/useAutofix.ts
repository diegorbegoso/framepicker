import { useEffect, useRef, useState } from "react";
import type { Adjustments, EngineEvent } from "../../lib/engine.ts";
import * as engine from "../../lib/engine.ts";
import { livePreview } from "../../lib/livePreview.ts";
import type { Edits } from "./useEdits.ts";

type Running = { jobId: string | null; ids: string[]; done: number; total: number };
type Finished = { state: string; fixed: number };

/**
 * Automatic correction: one photo right away, or a whole group as a background job. What the
 * photos had before is remembered, so the last automatic correction can be undone in one step.
 */
export function useAutofix(
  sessionId: string,
  edits: Edits,
  onError: (message: string | null) => void,
) {
  const [whiteBalance, setWhiteBalance] = useState(false);
  const [running, setRunning] = useState<Running | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [undoable, setUndoable] = useState<Record<string, Adjustments | null> | null>(null);
  const runningRef = useRef<Running | null>(null);
  const finishedEarly = useRef(new Map<string, Finished>());
  const before = useRef<Record<string, Adjustments | null>>({});
  const latestEdits = useRef(edits);
  latestEdits.current = edits;

  function update(next: Running | null) {
    runningRef.current = next;
    setRunning(next);
  }

  async function finish(ids: string[], { state, fixed }: Finished) {
    update(null);
    if (state === "failed") {
      onError("No se pudo aplicar la corrección automática.");
      return;
    }
    // The job saved its corrections in the engine: read them back and refresh what is on screen.
    await latestEdits.current.reload();
    for (const id of ids) livePreview.clear(id);
    setUndoable(before.current);
    const photos = fixed === 1 ? "1 foto" : `${fixed} fotos`;
    setMessage(
      state === "cancelled"
        ? `Cancelado: ${fixed === 1 ? "se corrigió" : "se corrigieron"} ${photos}.`
        : `Corrección automática aplicada a ${photos}.`,
    );
  }

  function handle(event: EngineEvent) {
    if (event.params.kind !== "autofix") return;
    const current = runningRef.current;
    if (event.method === "progress") {
      if (current && current.jobId === event.params.job_id) {
        update({ ...current, done: event.params.done, total: event.params.total });
      }
      return;
    }
    const done: Finished = { state: event.params.state, fixed: event.params.fixed ?? 0 };
    if (current && current.jobId === null) finishedEarly.current.set(event.params.job_id, done);
    else if (current && current.jobId === event.params.job_id) void finish(current.ids, done);
  }

  const handler = useRef(handle);
  handler.current = handle;

  useEffect(() => {
    // Outside the desktop shell (browser preview, tests) there is no event bus; that is not an error.
    const unlisten = engine
      .onEngineEvent((event) => handler.current(event))
      .catch(() => () => undefined);
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  /** Notes what these photos have now, so that "Deshacer" can bring it back. */
  function remember(ids: string[]) {
    before.current = latestEdits.current.snapshot(ids);
    setUndoable(null);
    setMessage(null);
  }

  /** What the program would do to this photo, or null if it could not tell. */
  async function suggestFor(photoId: string): Promise<Adjustments | null> {
    try {
      return await engine.autofixSuggest(photoId, whiteBalance);
    } catch {
      onError("No se pudo calcular la corrección automática.");
      return null;
    }
  }

  async function runGroup(ids: string[]) {
    if (ids.length === 0 || runningRef.current) return;
    remember(ids);
    update({ jobId: null, ids, done: 0, total: 0 });
    try {
      const { job_id: jobId } = await engine.autofixRun(sessionId, ids, whiteBalance);
      const early = finishedEarly.current.get(jobId);
      finishedEarly.current.clear();
      if (early) await finish(ids, early);
      else update({ jobId, ids, done: 0, total: 0 });
    } catch {
      update(null);
      onError("No se pudo aplicar la corrección automática.");
    }
  }

  function cancel() {
    const job = runningRef.current?.jobId;
    if (job) void engine.cancel(job).catch(() => undefined);
  }

  async function undo() {
    if (!undoable) return;
    const entries = undoable;
    setUndoable(null);
    await latestEdits.current.put(entries);
    for (const id of Object.keys(entries)) livePreview.clear(id);
    setMessage("Se devolvieron las correcciones de antes.");
  }

  return {
    whiteBalance,
    setWhiteBalance,
    running,
    message,
    canUndo: undoable !== null,
    remember,
    suggestFor,
    runGroup,
    cancel,
    undo,
  };
}
