import { useCallback, useEffect, useRef, useState } from "react";
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
  type SessionSummary,
  scan,
  select,
} from "../lib/engine.ts";
import styles from "./HomeScreen.module.css";
import { AnalyzingPanel } from "./home/AnalyzingPanel.tsx";
import { Aurora } from "./home/Aurora.tsx";
import { ContactSheet } from "./home/ContactSheet.tsx";
import { Hero } from "./home/Hero.tsx";
import { StepsRibbon } from "./home/StepsRibbon.tsx";
import { RecentSessions } from "./RecentSessions.tsx";

type Props = {
  /** `notice` is set when the session came back with the work already done in it. */
  onResult: (sessionId: string, result: SelectResult, notice?: string) => void;
};
type Running = { sessionId: string; jobId: string | null; done: number; total: number };

const NOT_ALLOWED = "Esa carpeta no está permitida. Elígela de nuevo con el botón.";
const NO_PHOTOS = "No encontré fotos compatibles en esa selección.";
const FAILED = "No se pudo analizar la selección.";
const RESUMED = "Recuperé tu avance de estas fotos.";

export function HomeScreen({ onResult }: Props) {
  const [running, setRunning] = useState<Running | null>(null);
  const [error, setError] = useState<string | null>(null);
  // True from the click until the selection is scanned: the first answer can take a while when the
  // engine is still starting, and the buttons must not invite a second click meanwhile.
  const [preparing, setPreparing] = useState(false);
  const [covers, setCovers] = useState<string[]>([]);
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
      if (scanned.resumed) {
        // Picked before: its bursts, choices and corrections are saved, so there is nothing to analyse.
        onResult(scanned.session_id, await select(scanned.session_id), RESUMED);
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

  // The photos on the contact sheet come after the first paint, so they never delay the start.
  const showCovers = useCallback((sessions: SessionSummary[]) => {
    const wanted = sessions.slice(0, 3).flatMap((session) => session.covers);
    window.setTimeout(() => setCovers(wanted), 500);
  }, []);

  return (
    <div className={styles.root}>
      <Aurora />
      <div className={styles.content}>
        <section aria-labelledby="home-title" className={styles.hero}>
          <div className={styles.copy}>
            {running ? (
              <>
                <h2 id="home-title" className={styles.busyTitle}>
                  Estamos revisando tus fotos
                </h2>
                <AnalyzingPanel
                  done={running.done}
                  total={running.total}
                  canCancel={running.jobId !== null}
                  onCancel={() =>
                    running.jobId && void cancel(running.jobId).catch(() => undefined)
                  }
                />
              </>
            ) : (
              <Hero
                disabled={preparing}
                onFolder={() => void start("folder")}
                onFiles={() => void start("files")}
              />
            )}
            {preparing && !running && (
              <p role="status" className={styles.note}>
                Preparando tu selección…
              </p>
            )}
            {error && (
              <p role="alert" className={styles.alert}>
                {error}
              </p>
            )}
            <StepsRibbon />
          </div>
          <div className={styles.sheet}>
            <ContactSheet photos={covers} />
          </div>
        </section>
        <RecentSessions
          onOpen={onResult}
          disabled={preparing || running !== null}
          onSessions={showCovers}
        />
      </div>
    </div>
  );
}
