import { IconButton } from "../../components/IconButton.tsx";
import { InlineName } from "../../components/InlineName.tsx";
import type { LutChanges, LutInfo } from "../../lib/engine.ts";
import styles from "./LutDialog.module.css";

const NONE = "";

type Props = {
  lut: LutInfo;
  /** Names of the groups that exist, to move this LUT into one of them. */
  groups: string[];
  onChange: (lut: LutInfo, changes: LutChanges) => Promise<void>;
  onRemove: (lut: LutInfo) => void;
};

/** One LUT of the library: favourite, name you can change, group, and remove. */
export function LutRow({ lut, groups, onChange, onRemove }: Props) {
  return (
    <li className={styles.row}>
      <IconButton
        icon="star"
        label={
          lut.favorite ? `Quitar de favoritos ${lut.name}` : `Marcar como favorito ${lut.name}`
        }
        pressed={lut.favorite}
        className={lut.favorite ? styles.starOn : undefined}
        onClick={() => void onChange(lut, { favorite: !lut.favorite }).catch(() => undefined)}
      />
      <InlineName
        value={lut.name}
        label={`Cambiar el nombre de ${lut.name}`}
        fieldLabel={`Nombre del LUT ${lut.name}`}
        onSave={(name) => onChange(lut, { name })}
        className={styles.name}
      />
      <span className={styles.size}>
        {lut.size}×{lut.size}×{lut.size}
      </span>
      <select
        className={styles.move}
        aria-label={`Grupo de ${lut.name}`}
        value={lut.group ?? NONE}
        onChange={(event) =>
          void onChange(lut, {
            group: event.target.value === NONE ? null : event.target.value,
          }).catch(() => undefined)
        }
      >
        <option value={NONE}>Sin grupo</option>
        {groups.map((group) => (
          <option key={group} value={group}>
            {group}
          </option>
        ))}
      </select>
      <IconButton icon="x" label={`Quitar ${lut.name}`} onClick={() => onRemove(lut)} />
    </li>
  );
}
