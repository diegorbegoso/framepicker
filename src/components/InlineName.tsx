import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { cx } from "../lib/cx.ts";
import { Icon } from "./Icon.tsx";
import styles from "./InlineName.module.css";

type Props = {
  value: string;
  /** Saves the new name; it may refuse (throw), and the field then stays open to try again. */
  onSave: (name: string) => Promise<void>;
  /** What the pencil button is called for screen readers: "Cambiar el nombre de BODA". */
  label: string;
  maxLength?: number;
  className?: string;
};

/** A name you can change on the spot: pencil → field, Enter saves, Escape or leaving cancels. */
export function InlineName({ value, onSave, label, maxLength = 80, className }: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [failed, setFailed] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (!editing) return;
    field.current?.focus();
    field.current?.select();
  }, [editing]);

  function open() {
    setText(value);
    setFailed(false);
    setEditing(true);
  }

  async function commit() {
    const next = text.trim();
    if (saving.current) return;
    if (next === "" || next === value) {
      setEditing(false);
      return;
    }
    saving.current = true;
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      setFailed(true);
    } finally {
      saving.current = false;
    }
  }

  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <span className={cx(styles.root, className)}>
        <input
          ref={field}
          className={styles.input}
          value={text}
          maxLength={maxLength}
          aria-label="Nombre de la sesión"
          aria-invalid={failed || undefined}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={keys}
          onBlur={() => !saving.current && setEditing(false)}
        />
        {failed ? (
          <span role="alert" className={styles.error}>
            No se pudo guardar el nombre.
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className={cx(styles.root, className)}>
      <span className={styles.value} title={value}>
        {value}
      </span>
      <button type="button" className={styles.pencil} aria-label={label} onClick={open}>
        <Icon name="pencil" size={14} />
      </button>
    </span>
  );
}
