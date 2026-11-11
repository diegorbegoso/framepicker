import { type CSSProperties, useEffect, useRef, useState } from "react";
import {
  analyze,
  cancel,
  EngineError,
  type EngineEvent,
  onEngineEvent,
  PATH_NOT_ALLOWED,
  pickFiles,
  pickFolder,
  type SelectResult,
  scan,
  select,
} from "../lib/engine.ts";

type Props = { onResult: (sessionId: string, result: SelectResult) => void };
type Running = { sessionId: string; jobId: string | null; done: number; total: number };

const NOT_ALLOWED = "Esa carpeta no está permitida. Elígela de nuevo con el botón.";
const NO_PHOTOS = "No encontré fotos compatibles en esa selección.";
const FAILED = "No se pudo analizar la selección.";

const card: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--divider)",
  borderRadius: "var(--radius-card)",
  padding: "var(--space-6)",
  display: "grid",
  gap: "var(--space-4)",
  maxWidth: "640px",
};
const row: CSSProperties = { display: "flex", gap: "var(--space-3)", flexWrap: "wrap" };
const alertStyle: CSSProperties = { color: "var(--destructive)", margin: 0, fontWeight: 600 };

export function button(primary: boolean): CSSProperties {
  return {
    font: "inherit",
    padding: "var(--space-2) var(--space-4)",
    borderRadius: "var(--radius-control)",
    border: `1px solid ${primary ? "var(--primary)" : "var(--border)"}`,
    background: primary ? "var(--primary)" : "var(--surface)",
    color: primary ? "var(--primary-fg)" : "var(--fg)",
    cursor: "pointer",
  };
}

export function HomeScreen({ onResult }: Props) {
  const [running, setRunning] = useState<Running | null>(null);
  const [error, setError] = useState<string | null>(null);
  // True from the click until the selection is scanned: the first answer can take a while when the
  // engine is still starting, and the buttons must not invite a second click meanwhile.
  const [preparing, setPreparing] = useState(false);
  const runningRef = useRef<Running | null>(null);
  const finishedEarly = useRef(new Map<string, string>());

  function update(next: Running | null) {
    runningRef.current = next;
    setRunning(next);
  }

  async function finish(sessionId: string, state: string) {
    update(null);
    if (state === "cancelled") return;
    if (state !== "done") {
      setError(FAILED);
      return;
    }
    try {
      onResult(sessionId, await select(sessionId));
    } catch {
      setError(FAILED);
    }
  }

  function handle(event: EngineEvent) {
    const current = runningRef.current;
    const { job_id: jobId } = event.params;
    if (event.method === "job_done" && current && current.jobId === null) {
      finishedEarly.current.set(jobId, event.params.state);
      return;
    }
    if (!current || current.jobId !== jobId) return;
    if (event.method === "progress") {
      update({ ...current, done: event.params.done, total: event.params.total });
    } else {
      void finish(current.sessionId, event.params.state);
    }
  }

  // Subscribe once; the ref always points at the latest handler (and so the latest onResult).
  const handler = useRef(handle);
  handler.current = handle;

  useEffect(() => {
    // Outside the desktop shell (browser preview, tests) there is no event bus; that is not an error.
    const unlisten = onEngineEvent((event) => handler.current(event)).catch(() => () => undefined);
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  async function start(kind: "folder" | "files") {
    setPreparing(true);
    try {
      await pickAndAnalyze(kind);
    } finally {
      setPreparing(false);
    }
  }

  async function pickAndAnalyze(kind: "folder" | "files") {
    setError(null);
    let paths: string[] | null;
    try {
      const picked = kind === "folder" ? await pickFolder() : await pickFiles();
      paths = picked === null ? null : Array.isArray(picked) ? picked : [picked];
    } catch {
      setError(FAILED);
      return;
    }
    if (!paths || paths.length === 0) return;
    try {
      const scanned = await scan(paths);
      if (scanned.photos.length === 0) {
        setError(NO_PHOTOS);
        return;
      }
      const base = { sessionId: scanned.session_id, done: 0, total: scanned.photos.length };
      update({ ...base, jobId: null });
      const { job_id: jobId } = await analyze(scanned.session_id);
      const early = finishedEarly.current.get(jobId);
      finishedEarly.current.clear();
      if (early !== undefined) {
        await finish(scanned.session_id, early);
      } else {
        update({ ...base, jobId });
      }
    } catch (failure) {
      update(null);
      const notAllowed = failure instanceof EngineError && failure.code === PATH_NOT_ALLOWED;
      setError(notAllowed ? NOT_ALLOWED : FAILED);
    }
  }

  const label = running ? `Analizando ${running.done} de ${running.total} fotos` : "";

  return (
    <section aria-labelledby="home-title" style={card}>
      <h2 id="home-title" style={{ margin: 0 }}>
        Elige tus fotos
      </h2>
      <p style={{ margin: 0, color: "var(--fg-muted)" }}>
        Selecciona las mejores tomas de tus ráfagas, sin salir de tu equipo.
      </p>
      {running ? (
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          <span id="progress-label">{label}</span>
          <progress
            aria-labelledby="progress-label"
            aria-valuenow={running.done}
            aria-valuemin={0}
            aria-valuemax={running.total}
            value={running.done}
            max={Math.max(running.total, 1)}
            style={{ width: "100%", accentColor: "var(--primary)" }}
          />
          <div style={row}>
            <button
              type="button"
              style={button(false)}
              disabled={running.jobId === null}
              onClick={() => running.jobId && void cancel(running.jobId).catch(() => undefined)}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div style={row}>
          <button
            type="button"
            style={button(true)}
            disabled={preparing}
            onClick={() => void start("folder")}
          >
            Elegir carpeta
          </button>
          <button
            type="button"
            style={button(false)}
            disabled={preparing}
            onClick={() => void start("files")}
          >
            Elegir archivos
          </button>
        </div>
      )}
      {preparing && !running && (
        <p role="status" style={{ margin: 0, color: "var(--fg-muted)" }}>
          Preparando tu selección…
        </p>
      )}
      {error && (
        <p role="alert" style={alertStyle}>
          {error}
        </p>
      )}
    </section>
  );
}
