import type { ReactNode } from "react";
import { cx } from "../lib/cx.ts";
import styles from "./Badge.module.css";
import { Icon, type IconName } from "./Icon.tsx";

type Props = {
  tone?: "neutral" | "primary" | "success" | "stage";
  icon?: IconName;
  className?: string;
  children: ReactNode;
};

export function Badge({ tone = "neutral", icon, className, children }: Props) {
  return (
    <span className={cx(styles.root, styles[tone], className)}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  );
}
