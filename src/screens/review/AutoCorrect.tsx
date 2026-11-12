import { Button } from "../../components/Button.tsx";
import styles from "./AutoCorrect.module.css";

type AutoProps = {
  whiteBalance: boolean;
  onWhiteBalance: (on: boolean) => void;
  disabled: boolean;
  busy: boolean;
  onAuto: () => void;
};

/** The one-photo automatic correction, at the top of the panel. */
export function AutoTop({ whiteBalance, onWhiteBalance, disabled, busy, onAuto }: AutoProps) {
  return (
    <div className={styles.top}>
      <Button size="sm" icon="sparkle" disabled={disabled || busy} onClick={onAuto}>
        Automático
      </Button>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={whiteBalance}
          onChange={(event) => onWhiteBalance(event.target.checked)}
        />
        Balance de blancos
      </label>
    </div>
  );
}

type GroupProps = {
  /** How many photos the chosen group reaches. */
  count: number;
  running: { done: number; total: number } | null;
  message: string | null;
  canUndo: boolean;
  onRun: () => void;
  onCancel: () => void;
  onUndo: () => void;
};

/** The automatic correction for a group of photos, with its progress and its undo. */
export function AutoGroup({
  count,
  running,
  message,
  canUndo,
  onRun,
  onCancel,
  onUndo,
}: GroupProps) {
  return (
    <div className={styles.group}>
      {running ? (
        <div className={styles.progress}>
          <span id="autofix-label">
            {running.total > 0
              ? `Corrigiendo ${running.done} de ${running.total}`
              : "Preparando la corrección…"}
          </span>
          <progress
            aria-labelledby="autofix-label"
            value={running.done}
            max={Math.max(running.total, 1)}
          />
          <Button size="sm" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      ) : (
        <div className={styles.row}>
          <Button size="sm" icon="sparkle" disabled={count === 0} onClick={onRun}>
            Automático al grupo
          </Button>
          {canUndo ? (
            <Button size="sm" variant="ghost" onClick={onUndo}>
              Deshacer
            </Button>
          ) : null}
        </div>
      )}
      {message ? (
        <p role="status" className={styles.message}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
