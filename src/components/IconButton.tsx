import type { ButtonHTMLAttributes } from "react";
import { cx } from "../lib/cx.ts";
import { Icon, type IconName } from "./Icon.tsx";
import styles from "./IconButton.module.css";

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  icon: IconName;
  /** The accessible name and the tooltip. Required: an icon alone says nothing to a screen reader. */
  label: string;
  /** For toggles (compare, panel): announces on/off. */
  pressed?: boolean;
  /** For buttons on the dark photo stage. */
  tone?: "default" | "stage";
  shortcut?: string;
};

export function IconButton({
  icon,
  label,
  pressed,
  tone = "default",
  shortcut,
  className,
  type = "button",
  ...rest
}: Props) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${label} (${shortcut})` : label}
      className={cx(styles.root, tone === "stage" && styles.stage, className)}
      {...rest}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}
