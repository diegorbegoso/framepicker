import { Button } from "../../components/Button.tsx";
import { InlineName } from "../../components/InlineName.tsx";
import type { SessionSummary } from "../../lib/engine.ts";
import { usePreview } from "../../lib/previews.ts";
import { relativeTime } from "../../lib/relativeTime.ts";
import { useInView } from "../../lib/useInView.ts";
import styles from "./SessionCard.module.css";

type Props = {
  session: SessionSummary;
  /** Index in the list, to stagger the entrance. */
  index: number;
  disabled: boolean;
  onOpen: () => void;
  onRename: (name: string) => Promise<void>;
  onForget: () => void;
};

const SLOTS = [0, 1, 2] as const;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Cover({ photoId, visible }: { photoId: string | undefined; visible: boolean }) {
  const { image } = usePreview(visible ? photoId : undefined, "thumb", 2);
  return (
    <span className={styles.cover}>
      {image ? <img src={image.url} alt="" draggable={false} /> : null}
    </span>
  );
}

/** A session worked on before: its photos, its name (changeable), how far it got, and how to go on. */
export function SessionCard({ session, index, disabled, onOpen, onRename, onForget }: Props) {
  const { ref, seen } = useInView<HTMLLIElement>();
  const progress = session.bursts > 0 ? Math.round((session.reviewed / session.bursts) * 100) : 0;
  return (
    <li
      ref={ref}
      className={styles.card}
      style={{ "--i": index } as React.CSSProperties}
      data-testid="session-card"
    >
      <span className={styles.collage} aria-hidden="true">
        {SLOTS.map((slot) => (
          <Cover key={slot} photoId={session.covers[slot]} visible={seen} />
        ))}
      </span>
      <div className={styles.text}>
        <InlineName
          value={session.label}
          label={`Cambiar el nombre de ${session.label}`}
          onSave={onRename}
          className={styles.name}
        />
        <span className={styles.folder} title={session.folder}>
          {session.folder}
        </span>
        <span className={styles.stats}>
          {plural(session.photos, "foto", "fotos")} ·{" "}
          {plural(session.picked, "elegida", "elegidas")} · {session.reviewed} de {session.bursts}{" "}
          ráfagas revisadas
          {session.edited > 0 ? ` · ${plural(session.edited, "corregida", "corregidas")}` : ""}
        </span>
        <span className={styles.track} aria-hidden="true">
          <span className={styles.fill} style={{ width: `${progress}%` }} />
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
          disabled={disabled || !session.available}
          onClick={onOpen}
        >
          Continuar
        </Button>
        <Button size="sm" variant="ghost" aria-label={`Quitar ${session.label}`} onClick={onForget}>
          Quitar
        </Button>
      </div>
    </li>
  );
}
