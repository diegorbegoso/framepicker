import { useEffect, useState } from "react";
import styles from "./Notice.module.css";

type Props = {
  text: string | undefined;
  /** How long it stays, in milliseconds. */
  lasts?: number;
};

/** A short message that says something good happened and then goes away by itself. */
export function Notice({ text, lasts = 5000 }: Props) {
  const [shown, setShown] = useState(true);

  useEffect(() => {
    if (!text) return;
    const timer = window.setTimeout(() => setShown(false), lasts);
    return () => window.clearTimeout(timer);
  }, [text, lasts]);

  if (!text || !shown) return null;
  return (
    <p role="status" className={styles.root}>
      {text}
    </p>
  );
}
