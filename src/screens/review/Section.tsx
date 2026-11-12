import { type ReactNode, useId, useState } from "react";
import { Icon } from "../../components/Icon.tsx";
import styles from "./Section.module.css";

type Props = {
  title: string;
  /** Open when the panel first shows. */
  defaultOpen?: boolean;
  /** A small mark that something in here is changed. */
  changed?: boolean;
  children: ReactNode;
};

/** A part of the panel that folds away, so a long list of sliders never overwhelms. */
export function Section({ title, defaultOpen = false, changed = false, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  return (
    <section className={styles.root}>
      <h4 className={styles.heading}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} size={16} />
          {title}
          {changed ? <span className={styles.dot} role="img" aria-label="con cambios" /> : null}
        </button>
      </h4>
      {open ? (
        <div id={bodyId} className={styles.body}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
