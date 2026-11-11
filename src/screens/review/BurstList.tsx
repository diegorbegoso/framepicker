import { useEffect, useId } from "react";
import { Button } from "../../components/Button.tsx";
import { Icon } from "../../components/Icon.tsx";
import { SegmentedControl } from "../../components/SegmentedControl.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import { cx } from "../../lib/cx.ts";
import type { SelectedBurst } from "../../lib/engine.ts";
import { usePreview } from "../../lib/previews.ts";
import { useInView } from "../../lib/useInView.ts";
import styles from "./BurstList.module.css";

export type BurstFilter = "all" | "todo";

/** A burst is reviewed once the person confirmed it or changed one of its picks. */
export const isReviewed = (burst: SelectedBurst) => burst.photos.some((p) => p.source === "user");

type Props = {
  bursts: SelectedBurst[];
  activeId: string | undefined;
  filter: BurstFilter;
  onFilter: (filter: BurstFilter) => void;
  onSelect: (burstId: string) => void;
  onReset: () => void;
};

function BurstItem({
  burst,
  active,
  onSelect,
}: {
  burst: SelectedBurst;
  active: boolean;
  onSelect: (burstId: string) => void;
}) {
  const { ref, seen } = useInView<HTMLButtonElement>();
  const first = burst.photos[0];
  const thumb = usePreview(seen ? first?.id : undefined, "thumb", 2);
  const picked = burst.photos.filter((p) => p.selected).length;
  const reviewed = isReviewed(burst);
  const infoId = useId();

  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [active, ref]);

  return (
    <button
      ref={ref}
      type="button"
      aria-label={`Ráfaga ${burst.position + 1} · ${burst.photos.length} fotos`}
      aria-describedby={infoId}
      aria-current={active ? "true" : undefined}
      className={cx(styles.item, active && styles.active)}
      onClick={() => onSelect(burst.id)}
    >
      <span className={styles.thumb}>
        {thumb.image ? <img src={thumb.image.url} alt="" /> : <Skeleton className={styles.fill} />}
      </span>
      <span className={styles.text}>
        <span className={styles.name}>Ráfaga {burst.position + 1}</span>
        <span className={styles.meta}>
          {burst.photos.length} fotos · {picked} elegidas
        </span>
      </span>
      <span className={cx(styles.state, reviewed && styles.done)}>
        <Icon name={reviewed ? "circle-check" : "circle"} size={18} />
      </span>
      <span id={infoId} className={styles.srOnly}>
        {`${picked} de ${burst.photos.length} elegidas, ${reviewed ? "revisada" : "sin revisar"}`}
      </span>
    </button>
  );
}

export function BurstList({ bursts, activeId, filter, onFilter, onSelect, onReset }: Props) {
  const reviewed = bursts.filter(isReviewed).length;
  const visible = filter === "todo" ? bursts.filter((b) => !isReviewed(b)) : bursts;
  const share = bursts.length === 0 ? 0 : Math.round((reviewed / bursts.length) * 100);

  return (
    <nav aria-label="Ráfagas" className={styles.root}>
      <header className={styles.header}>
        <div className={styles.progress}>
          <span className={styles.progressText}>
            Revisadas {reviewed} de {bursts.length}
          </span>
          <span className={styles.bar} aria-hidden="true">
            <span className={styles.barFill} style={{ width: `${share}%` }} />
          </span>
        </div>
        <SegmentedControl
          label="Mostrar"
          value={filter}
          onChange={onFilter}
          options={[
            { value: "all", label: "Todas", count: bursts.length },
            { value: "todo", label: "Sin revisar", count: bursts.length - reviewed },
          ]}
        />
      </header>
      <ul className={styles.list}>
        {visible.map((burst) => (
          <li key={burst.id}>
            <BurstItem burst={burst} active={burst.id === activeId} onSelect={onSelect} />
          </li>
        ))}
        {visible.length === 0 ? (
          <li className={styles.empty}>Ya revisaste todas las ráfagas.</li>
        ) : null}
      </ul>
      <footer className={styles.footer}>
        <Button variant="ghost" size="sm" icon="folder" onClick={onReset}>
          Elegir otras fotos
        </Button>
        <span className={styles.saved}>Tu avance queda guardado</span>
      </footer>
    </nav>
  );
}
