import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import * as engine from "../../lib/engine.ts";
import { summarizeLuts } from "../../lib/lutSummary.ts";
import styles from "./LutDialog.module.css";
import { LutGroup } from "./LutGroup.tsx";
import { LutRow } from "./LutRow.tsx";

type Props = {
  /** Called after a LUT is added or removed, so the rest of the screen reads the library again. */
  onChanged: () => void;
  onClose: () => void;
};

/** Favourites first, then by name. */
const order = (a: engine.LutInfo, b: engine.LutInfo) =>
  Number(b.favorite) - Number(a.favorite) ||
  a.name.localeCompare(b.name, "es", { sensitivity: "base" });

/** The LUTs kept in the program: load them once and they stay for every photo and every session. */
export function LutDialog({ onChanged, onClose }: Props) {
  const [luts, setLuts] = useState<engine.LutInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLuts(await engine.listLuts());
    } catch {
      setError("No se pudo leer la biblioteca de LUT.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Runs a load, then shows what came of it: some may go in while others are repeated or broken. */
  async function load(pick: () => Promise<engine.LutsAdded | null>) {
    setError(null);
    setStatus("");
    setBusy(true);
    try {
      const result = await pick();
      if (result === null) return;
      await refresh();
      onChanged();
      const text = summarizeLuts(result);
      if (result.added.length === 0 && result.failed.length > 0) setError(text);
      else setStatus(text);
    } catch {
      setError("No se pudieron cargar los LUT.");
    } finally {
      setBusy(false);
    }
  }

  const loadFiles = () =>
    load(async () => {
      const paths = await engine.pickLuts();
      return paths && paths.length > 0 ? engine.addLuts(paths) : null;
    });

  const loadFolder = () =>
    load(async () => {
      const folder = await engine.pickFolder();
      return folder === null ? null : engine.addLutFolder(folder);
    });

  const { loose, groups } = useMemo(() => {
    const map = new Map<string, engine.LutInfo[]>();
    const rest: engine.LutInfo[] = [];
    for (const lut of luts) {
      if (lut.group === null) rest.push(lut);
      else map.set(lut.group, [...(map.get(lut.group) ?? []), lut]);
    }
    return {
      loose: rest.sort(order),
      groups: [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b, "es", { sensitivity: "base" }))
        .map(([name, items]) => ({ name, items: items.sort(order) })),
    };
  }, [luts]);

  async function change(lut: engine.LutInfo, changes: engine.LutChanges) {
    try {
      const saved = await engine.updateLut(lut.id, changes);
      setLuts((all) => all.map((item) => (item.id === saved.id ? saved : item)));
      onChanged();
    } catch (failure) {
      setError("No se pudo guardar el cambio.");
      throw failure;
    }
  }

  async function renameGroup(from: string, to: string) {
    try {
      await engine.renameLutGroup(from, to);
      await refresh();
      onChanged();
    } catch (failure) {
      setError("No se pudo renombrar el grupo.");
      throw failure;
    }
  }

  async function removeGroup(group: string) {
    try {
      const { removed } = await engine.removeLutGroup(group);
      await refresh();
      onChanged();
      setStatus(`Se quitó el grupo ${group} (${removed} LUT).`);
    } catch {
      setError("No se pudo quitar el grupo.");
    }
  }

  async function remove(lut: engine.LutInfo) {
    try {
      await engine.removeLut(lut.id);
      await refresh();
      onChanged();
      setStatus(`Se quitó ${lut.name}.`);
    } catch {
      setError("No se pudo quitar el LUT.");
    }
  }

  return (
    <Dialog title="Biblioteca de LUT" onClose={onClose}>
      <p className={styles.help}>
        Un LUT cambia el color de las fotos, como un filtro. Se carga una sola vez y queda guardado
        en el programa. Después lo eliges en «Corrección básica», para una foto o para un grupo.
      </p>
      <div className={styles.buttons}>
        <Button variant="primary" icon="sparkle" disabled={busy} onClick={() => void loadFiles()}>
          Cargar LUT…
        </Button>
        <Button icon="folder" disabled={busy} onClick={() => void loadFolder()}>
          Cargar carpeta…
        </Button>
      </div>
      <p className={styles.hint}>
        Puedes elegir varios archivos .cube a la vez, o una carpeta entera: queda como un grupo con
        el nombre de la carpeta.
      </p>
      <ul className={`${styles.list} ${styles.scroll}`} aria-label="LUT guardados">
        {loose.map((lut) => (
          <LutRow
            key={lut.id}
            lut={lut}
            groups={groups.map((g) => g.name)}
            onChange={change}
            onRemove={(item) => void remove(item)}
          />
        ))}
        {groups.map((group) => (
          <LutGroup
            key={group.name}
            name={group.name}
            count={group.items.length}
            onRename={(to) => renameGroup(group.name, to)}
            onRemove={() => removeGroup(group.name)}
          >
            {group.items.map((lut) => (
              <LutRow
                key={lut.id}
                lut={lut}
                groups={groups.map((g) => g.name)}
                onChange={change}
                onRemove={(item) => void remove(item)}
              />
            ))}
          </LutGroup>
        ))}
      </ul>
      {luts.length === 0 ? <p className={styles.empty}>Aún no has cargado ningún LUT.</p> : null}
      <p role="status" className={styles.status}>
        {status}
      </p>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}
