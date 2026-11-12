import { Button } from "../../components/Button.tsx";
import styles from "./AnalyzingPanel.module.css";

type Props = {
  done: number;
  total: number;
  /** Cancelling needs the job's id, which arrives a moment after the work starts. */
  canCancel: boolean;
  onCancel: () => void;
};

/** What replaces the two big buttons while the photos are being analysed. */
export function AnalyzingPanel({ done, total, canCancel, onCancel }: Props) {
  const label = `Analizando ${done} de ${total} fotos`;
  return (
    <div className={styles.root}>
      <span id="progress-label" className={styles.label}>
        {label}
      </span>
      <progress
        className={styles.bar}
        aria-labelledby="progress-label"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        value={done}
        max={Math.max(total, 1)}
      />
      <p className={styles.hint}>
        Puedes seguir mirando esta pantalla; al terminar se abre la revisión sola.
      </p>
      <Button disabled={!canCancel} onClick={onCancel}>
        Cancelar
      </Button>
    </div>
  );
}
