import type { CSSProperties } from "react";
import { cx } from "../lib/cx.ts";
import styles from "./Skeleton.module.css";

type Props = {
  /** CSS aspect-ratio such as "3 / 2": reserves the space so the layout does not jump when loaded. */
  ratio?: string;
  className?: string;
  style?: CSSProperties;
};

/** A placeholder while something loads. Decorative: the surrounding text announces the state. */
export function Skeleton({ ratio, className, style }: Props) {
  return (
    <div
      aria-hidden="true"
      className={cx(styles.root, className)}
      style={{ aspectRatio: ratio, ...style }}
    />
  );
}
