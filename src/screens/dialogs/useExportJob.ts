import { useEffect, useRef, useState } from "react";
import {
  DEST_INSIDE_SOURCE,
  EngineError,
  type EngineEvent,
  type ExportOptions,
  exportSelection,
  onEngineEvent,
  PATH_NOT_ALLOWED,
  pickFolder,
} from "../../lib/engine.ts";

type Copying = { dest: string; jobId: string | null; done: number; total: number };
type Finished = { state: string; copied: number; failed: number };

const INSIDE_SOURCE = "Esa carpeta está dentro de la carpeta de origen. Elige otra.";
const NOT_ALLOWED = "Esa carpeta no está permitida. Elígela de nuevo con el botón.";
const FAILED = "No se pudo exportar.";

function errorMessage(failure: unknown): string {
  if (!(failure instanceof EngineError)) return FAILED;
  if (failure.code === DEST_INSIDE_SOURCE) return INSIDE_SOURCE;
  if (failure.code === PATH_NOT_ALLOWED) return NOT_ALLOWED;
  return FAILED;
}

/** Runs an export and follows its progress through the engine's events. */
export function useExportJob(sessionId: string, selectedCount: number) {
  const [copying, setCopying] = useState<Copying | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copyingRef = useRef<Copying | null>(null);
  const finishedEarly = useRef(new Map<string, Finished>());
  const copyMode = useRef(true);

  function update(next: Copying | null) {
    copyingRef.current = next;
    setCopying(next);
  }

  function finish(dest: string, { state, copied, failed }: Finished) {
    update(null);
    if (state === "done") {
      const verb = copyMode.current ? "copiaron" : "exportaron";
      const missed = failed > 0 ? ` No se pudieron procesar ${failed}.` : "";
      setSuccess(`Se ${verb} ${copied} fotos a ${dest}. Tus originales no se tocaron.${missed}`);
    } else if (state !== "cancelled") {
      setError(FAILED);
    }
  }

  function handle(event: EngineEvent) {
    if (event.params.kind !== "export") return;
    const current = copyingRef.current;
    if (event.method === "progress") {
      if (current && current.jobId === event.params.job_id) {
        update({ ...current, done: event.params.done, total: event.params.total });
      }
      return;
    }
    const done: Finished = {
      state: event.params.state,
      copied: event.params.copied ?? 0,
      failed: event.params.failed,
    };
    if (current && current.jobId === null) {
      finishedEarly.current.set(event.params.job_id, done);
    } else if (current && current.jobId === event.params.job_id) {
      finish(current.dest, done);
    }
  }

  const handler = useRef(handle);
  handler.current = handle;

  useEffect(() => {
    // Outside the desktop shell (browser preview, tests) there is no event bus; that is not an error.
    const unlisten = onEngineEvent((event) => handler.current(event)).catch(() => () => undefined);
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  async function start(options: ExportOptions, isCopy: boolean) {
    setError(null);
    setSuccess(null);
    try {
      const dest = await pickFolder();
      if (dest === null) return;
      copyMode.current = isCopy;
      update({ dest, jobId: null, done: 0, total: selectedCount });
      const { job_id: jobId } = await exportSelection(sessionId, dest, options);
      const early = finishedEarly.current.get(jobId);
      finishedEarly.current.clear();
      if (early) finish(dest, early);
      else update({ dest, jobId, done: 0, total: selectedCount });
    } catch (failure) {
      update(null);
      setError(errorMessage(failure));
    }
  }

  return { copying, success, error, start };
}
