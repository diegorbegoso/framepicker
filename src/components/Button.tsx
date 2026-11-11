import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx.ts";
import styles from "./Button.module.css";
import { Icon, type IconName } from "./Icon.tsx";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** `stage` is for controls that sit on the dark photo stage. */
  variant?: "primary" | "secondary" | "ghost" | "stage";
  size?: "sm" | "md";
  icon?: IconName;
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  type = "button",
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={cx(styles.root, styles[variant], size === "sm" && styles.sm, className)}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 15 : 17} /> : null}
      {children}
    </button>
  );
}
