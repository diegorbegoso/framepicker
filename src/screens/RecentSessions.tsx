import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/Button.tsx";
import { Dialog } from "../components/Dialog.tsx";
import { InlineName } from "../components/InlineName.tsx";
import {
  EngineError,
  type SelectResult,
  type SessionSummary,
  select,
  sessionForget,
  sessionRename,
  sessionsList,
} from "../lib/engine.ts";
import { relativeTime } from "../lib/relativeTime.ts";
import styles from "./RecentSessions.module.css";

type Props = {
  /** Opens a session on the review screen. */
  onOpen: (sessionId: string, result: SelectResult) => void;
  /** Disabled while something else is being prepared. */
  disabled: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The work already begun, so leaving a review (or the app) never means starting again. */
export function RecentSessions({ onOpen, disabled }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [asking, setAsking] = useState<SessionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [forgetError, setForgetError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    sessionsList()
      .then(setSessions)
      .catch(() => undefined);
  }, []);

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
        {sessions.map((session) => (
          <li key={session.id} className={styles.card}>
            <div className={styles.text}>
              <InlineName
                value={session.label}
                label={`Cambiar el nombre de ${session.label}`}
                onSave={(name) => rename(session, name)}
                className={styles.name}
              />
              <span className={styles.folder} title={session.folder}>
                {session.folder}
              </span>
              <span className={styles.stats}>
                {plural(session.photos, "foto", "fotos")} ·{" "}
                {plural(session.picked, "elegida", "elegidas")} · {session.reviewed} de{" "}
                {session.bursts} ráfagas revisadas
                {session.edited > 0
                  ? ` · ${plural(session.edited, "corregida", "corregidas")}`
                  : ""}
              </span>
              <span className={styles.when}>{relativeTime(session.updated_at)}</span>
              {session.available ? null : (
                <span role="note" className={styles.missing}>
                  No encuentro estas fotos: puede que las hayas movido.
                </span>
              )}
            </div>
            <div className={styles.actions}>
              <Button
                variant="primary"
                size="sm"
                aria-label={`Continuar ${session.label}`}
                disabled={disabled || !session.available || opening !== null}
                onClick={() => void open(session)}
              >
                Continuar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Quitar ${session.label}`}
                disabled={opening !== null}
                onClick={() => {
                  setForgetError(null);
                  setAsking(session);
                }}
              >
                Quitar
              </Button>
            </div>
          </li>
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
