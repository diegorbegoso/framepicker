import { type KeyboardEvent, useState } from "react";
import styles from "./NumberField.module.css";

type Props = {
  /** The accessible name, e.g. "Exposición (valor)". */
  label: string;
  value: number;
  min: number;
  max: number;
  /** What ↑ and ↓ add; Shift makes it ten times bigger. */
  step: number;
  /** Shown after the number ("EV", "%"). */
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
};

const show = (value: number) => String(Number(value.toFixed(2)));

/** Reads "1,5", "1.5", "+2" or "-0.25"; anything else is not a number yet (null). */
export function parseNumber(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (clean === "" || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(clean)) return null;
  return Number(clean);
}

/**
 * A number you can type, or nudge with the arrow keys. It follows what you type as soon as it is a
 * valid number (kept inside the range), and writes the neat value back when you leave it.
 */
export function NumberField({ label, value, min, max, step, unit, disabled, onChange }: Props) {
  const [text, setText] = useState<string | null>(null); // null: not being edited
  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  function type(next: string) {
    setText(next);
    const parsed = parseNumber(next);
    if (parsed !== null) onChange(clamp(parsed));
  }

  function nudge(event: KeyboardEvent<HTMLInputElement>) {
    const direction = event.key === "ArrowUp" ? 1 : event.key === "ArrowDown" ? -1 : 0;
    if (direction === 0) {
      if (event.key === "Enter") event.currentTarget.blur();
      return;
    }
    event.preventDefault();
    const base = parseNumber(text ?? "") ?? value;
    const next = clamp(Number((base + direction * step * (event.shiftKey ? 10 : 1)).toFixed(4)));
    setText(show(next));
    onChange(next);
  }

  return (
    <span className={styles.root}>
      <input
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        className={styles.input}
        disabled={disabled}
        value={text ?? show(value)}
        onFocus={(event) => {
          setText(show(value));
          event.currentTarget.select();
        }}
        onChange={(event) => type(event.target.value)}
        onKeyDown={nudge}
        onBlur={() => setText(null)}
      />
      {unit ? (
        <span className={styles.unit} aria-hidden="true">
          {unit}
        </span>
      ) : null}
    </span>
  );
}
