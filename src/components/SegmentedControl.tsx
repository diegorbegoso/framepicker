import { useId } from "react";
import { cx } from "../lib/cx.ts";
import { Icon, type IconName } from "./Icon.tsx";
import styles from "./SegmentedControl.module.css";

type Option<T extends string> = { value: T; label: string; icon?: IconName; count?: number };

type Props<T extends string> = {
  /** The accessible name of the group, e.g. "Mostrar". */
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
};

/** One choice out of a few. Native radios, so arrow keys and screen readers work for free. */
export function SegmentedControl<T extends string>({ label, value, options, onChange }: Props<T>) {
  const name = useId();
  return (
    <fieldset className={styles.root}>
      <legend className={styles.legend}>{label}</legend>
      {options.map((option) => (
        <label key={option.value} className={styles.option}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            className={styles.input}
          />
          <span className={cx(styles.face, option.value === value && styles.active)}>
            {option.icon ? <Icon name={option.icon} size={15} /> : null}
            {option.label}
            {option.count === undefined ? null : (
              <span className={styles.count}>{option.count}</span>
            )}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
