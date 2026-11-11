import type { ReactNode } from "react";
import styles from "./Kbd.module.css";

/** A keyboard key in a hint: <Kbd>Espacio</Kbd>. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={styles.root}>{children}</kbd>;
}
