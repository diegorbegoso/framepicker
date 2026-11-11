import { type ReactNode, useEffect, useId, useRef } from "react";
import styles from "./Dialog.module.css";
import { IconButton } from "./IconButton.tsx";

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select, textarea";

/** A window over the app: focus stays inside, Escape closes it, and focus goes back afterwards. */
export function Dialog({ title, onClose, children }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement;
    root.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      if (before instanceof HTMLElement) before.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      } else if (event.key === "Tab") {
        const nodes = [...(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={styles.backdrop}>
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <IconButton icon="x" label="Cerrar" shortcut="Esc" onClick={onClose} />
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
