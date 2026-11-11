import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button.tsx";
import { Panel } from "../components/Panel.tsx";
import {
  DEST_INSIDE_SOURCE,
  EngineError,
  type EngineEvent,
  exportSelection,
  onEngineEvent,
  PATH_NOT_ALLOWED,
  pickFolder,
} from "../lib/engine.ts";
import styles from "./ExportPanel.module.css";

type Props = { sessionId: string; selectedCount: number };
type Copying = { dest: string; jobId: string | null; done: number; total: number };
type Finished = { state: string; copied: number };

const INSIDE_SOURCE = "Esa carpeta está dentro de la carpeta de origen. Elige otra.";
const NOT_ALLOWED = "Esa carpeta no está permitida. Elígela de nuevo con el botón.";
const FAILED = "No se pudo exportar.";

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
    <Panel title="Exportar" icon="download">
      <Button
        variant="primary"
        icon="download"
        disabled={empty || copying !== null}
        onClick={() => void start()}
      >
        Exportar elegidas
      </Button>
      {empty && <p className={styles.note}>Elige al menos una foto para exportar.</p>}
      {copying && <p className={styles.note}>{`Copiando ${copying.done} de ${copying.total}`}</p>}
      {success && (
        <p role="status" className={styles.success}>
          {success}
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </Panel>
  );
}
