import { type CSSProperties, useEffect, useRef, useState } from "react";
import {
  DEST_INSIDE_SOURCE,
  EngineError,
  type EngineEvent,
  exportSelection,
  onEngineEvent,
  PATH_NOT_ALLOWED,
  pickFolder,
} from "../lib/engine.ts";
import { button } from "./HomeScreen.tsx";

type Props = { sessionId: string; selectedCount: number };
type Copying = { dest: string; jobId: string | null; done: number; total: number };
type Finished = { state: string; copied: number };

const INSIDE_SOURCE = "Esa carpeta está dentro de la carpeta de origen. Elige otra.";
const NOT_ALLOWED = "Esa carpeta no está permitida. Elígela de nuevo con el botón.";
const FAILED = "No se pudo exportar.";

/** The card style shared by the side panels of the review screen. */
export const panel: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--divider)",
  borderRadius: "var(--radius-card)",
  padding: "var(--space-4)",
  display: "grid",
  gap: "var(--space-3)",
};
const note: CSSProperties = { margin: 0, color: "var(--fg-muted)" };

function errorMessage(failure: unknown): string {
  if (!(failure instanceof EngineError)) return FAILED;
  if (failure.code === DEST_INSIDE_SOURCE) return INSIDE_SOURCE;
  if (failure.code === PATH_NOT_ALLOWED) return NOT_ALLOWED;
  return FAILED;
}

export function ExportPanel({ sessionId, selectedCount }: Props) {
  const [copying, setCopying] = useState<Copying | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copyingRef = useRef<Copying | null>(null);
  const finishedEarly = useRef(new Map<string, Finished>());

  function update(next: Copying | null) {
    copyingRef.current = next;
    setCopying(next);
  }

  function finish(dest: string, { state, copied }: Finished) {
    update(null);
    if (state === "done") {
      setSuccess(`Se copiaron ${copied} fotos a ${dest}. Tus originales no se tocaron.`);
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
    const done: Finished = { state: event.params.state, copied: event.params.copied ?? 0 };
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

  async function start() {
    setError(null);
    setSuccess(null);
    try {
      const dest = await pickFolder();
      if (dest === null) return;
      update({ dest, jobId: null, done: 0, total: selectedCount });
      const { job_id: jobId } = await exportSelection(sessionId, dest);
      const early = finishedEarly.current.get(jobId);
      finishedEarly.current.clear();
      if (early) finish(dest, early);
      else update({ dest, jobId, done: 0, total: selectedCount });
    } catch (failure) {
      update(null);
      setError(errorMessage(failure));
    }
  }

  const empty = selectedCount === 0;
  return (
    <section aria-labelledby="export-title" style={panel}>
      <h3 id="export-title" style={{ margin: 0, fontSize: "var(--text-md)" }}>
        Exportar
      </h3>
      <button
        type="button"
        style={button(true)}
        disabled={empty || copying !== null}
        onClick={() => void start()}
      >
        Exportar elegidas
      </button>
      {empty && <p style={note}>Elige al menos una foto para exportar.</p>}
      {copying && <p style={note}>{`Copiando ${copying.done} de ${copying.total}`}</p>}
      {success && (
        <p role="status" style={{ margin: 0, color: "var(--success)" }}>
          {success}
        </p>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, color: "var(--destructive)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
