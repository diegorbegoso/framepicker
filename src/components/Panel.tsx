import { type ReactNode, useId } from "react";
import { cx } from "../lib/cx.ts";
import { Icon, type IconName } from "./Icon.tsx";
import styles from "./Panel.module.css";

type Props = {
  title?: string;
  icon?: IconName;
  /** Controls that sit in the header, to the right of the title. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
};

/** A card. With a title it is a labelled region, so screen readers can jump to it. */
export function Panel({ title, icon, actions, className, children }: Props) {
  const titleId = useId();
  return (
    <section aria-labelledby={title ? titleId : undefined} className={cx(styles.root, className)}>
      {title ? (
        <header className={styles.header}>
          <h3 id={titleId} className={styles.title}>
            {icon ? <Icon name={icon} size={16} /> : null}
            {title}
          </h3>
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}
