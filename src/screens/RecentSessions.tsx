import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/Button.tsx";
import { Dialog } from "../components/Dialog.tsx";
import {
  EngineError,
  type SelectResult,
  type SessionSummary,
  select,
  sessionForget,
  sessionRename,
  sessionsList,
} from "../lib/engine.ts";
import { SessionCard } from "./home/SessionCard.tsx";
import styles from "./RecentSessions.module.css";

type Props = {
  /** Opens a session on the review screen. */
  onOpen: (sessionId: string, result: SelectResult) => void;
  /** Disabled while something else is being prepared. */
  disabled: boolean;
  /** Told whenever the list is read, so the Home can show the covers. */
  onSessions?: (sessions: SessionSummary[]) => void;
};

/** The work already begun, so leaving a review (or the app) never means starting again. */
export function RecentSessions({ onOpen, disabled, onSessions }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [asking, setAsking] = useState<SessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [forgetError, setForgetError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    sessionsList()
      .then((found) => {
        setSessions(found);
        onSessions?.(found);
      })
      .catch(() => undefined);
  }, [onSessions]);

  useEffect(refresh, [refresh]);

  async function open(session: SessionSummary) {
    setError(null);
    setOpening(session.id);
    try {
      onOpen(session.id, await select(session.id));
    } catch {
      setError("No se pudo abrir esa sesión.");
      setOpening(null);
    }
  }

  async function forget(session: SessionSummary) {
    setForgetting(true);
    setForgetError(null);
    try {
      await sessionForget(session.id);
      setAsking(null);
      refresh();
    } catch (failure) {
      // The engine says why (for instance, that the database is busy): show it, and let them retry.
      const why = failure instanceof EngineError ? ` (${failure.message})` : "";
      setForgetError(`No se pudo quitar la sesión${why}. Vuelve a intentarlo.`);
    } finally {
      setForgetting(false);
    }
  }

  async function rename(session: SessionSummary, label: string) {
    const saved = await sessionRename(session.id, label);
    setSessions((all) => all.map((s) => (s.id === session.id ? { ...s, label: saved } : s)));
  }

  if (sessions.length === 0 && !error) return null;
  return (
    <section aria-labelledby="recent-title" className={styles.root}>
      <h2 id="recent-title" className={styles.title}>
        Continuar donde lo dejaste
      </h2>
      <ul className={styles.list}>
        {sessions.map((session, index) => (
          <SessionCard
            key={session.id}
            session={session}
            index={index}
            disabled={disabled || opening !== null}
            onOpen={() => void open(session)}
            onRename={(name) => rename(session, name)}
            onForget={() => {
              setForgetError(null);
              setAsking(session);
            }}
          />
        ))}
      </ul>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      {asking ? (
        <Dialog
          title="¿Quitar esta sesión?"
          onClose={() => {
            if (!forgetting) setAsking(null);
          }}
        >
          <p className={styles.sure}>
            Se olvidarán tus elecciones, las ráfagas revisadas y las correcciones de «{asking.label}
            ». Tus fotos no se tocan.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" disabled={forgetting} onClick={() => void forget(asking)}>
              {forgetting ? "Quitando…" : "Quitar sesión"}
            </Button>
            <Button disabled={forgetting} onClick={() => setAsking(null)}>
              Cancelar
            </Button>
          </div>
          {forgetError ? (
            <p role="alert" className={styles.error}>
              {forgetError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </section>
  );
}
