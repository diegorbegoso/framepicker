import { useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Icon } from "../../components/Icon.tsx";
import { IconButton } from "../../components/IconButton.tsx";
import { InlineName } from "../../components/InlineName.tsx";
import styles from "./LutDialog.module.css";

type Props = {
  name: string;
  count: number;
  onRename: (name: string) => Promise<void>;
  onRemove: () => Promise<void>;
  children: React.ReactNode;
};

/** A sub-list of the library (a folder that was loaded): folds away, can be renamed or removed. */
export function LutGroup({ name, count, onRename, onRemove, children }: Props) {
  const [open, setOpen] = useState(true);
  const [asking, setAsking] = useState(false);
  const [working, setWorking] = useState(false);

  async function confirm() {
    setWorking(true);
    try {
      await onRemove();
    } finally {
      setWorking(false);
      setAsking(false);
    }
  }

  return (
    <li className={styles.group}>
      <div className={styles.groupHead}>
        <button
          type="button"
          className={styles.fold}
          aria-expanded={open}
          aria-label={`${open ? "Plegar" : "Desplegar"} ${name}`}
          onClick={() => setOpen(!open)}
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} size={16} />
        </button>
        <InlineName
          value={name}
          label={`Cambiar el nombre del grupo ${name}`}
          fieldLabel={`Nombre del grupo ${name}`}
          maxLength={60}
          onSave={onRename}
          className={styles.groupName}
        />
        <span className={styles.count}>{count}</span>
        <IconButton
          icon="trash"
          label={`Quitar el grupo ${name}`}
          onClick={() => setAsking(true)}
        />
      </div>
      {asking ? (
        <div role="alert" className={styles.ask}>
          <span>
            Se quitarán los {count} LUT de «{name}».
          </span>
          <Button size="sm" variant="primary" disabled={working} onClick={() => void confirm()}>
            Quitar grupo
          </Button>
          <Button size="sm" disabled={working} onClick={() => setAsking(false)}>
            Cancelar
          </Button>
        </div>
      ) : null}
      {open ? <ul className={styles.list}>{children}</ul> : null}
    </li>
  );
}
