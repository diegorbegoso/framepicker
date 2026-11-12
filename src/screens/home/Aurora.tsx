import { useEffect, useRef } from "react";
import styles from "./Aurora.module.css";

/**
 * Three soft lights drifting behind the Home screen, over a fine dot grid. Pure CSS: only
 * `transform` is animated, and the drifting stops while the window is hidden (and for people
 * who asked for less motion).
 */
export function Aurora() {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => {
      root.current?.setAttribute("data-paused", String(document.hidden));
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return (
    <div ref={root} className={styles.root} aria-hidden="true" data-testid="aurora">
      <span className={`${styles.blob} ${styles.one}`} />
      <span className={`${styles.blob} ${styles.two}`} />
      <span className={`${styles.blob} ${styles.three}`} />
      <span className={styles.dots} />
    </div>
  );
}
