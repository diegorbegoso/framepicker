import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { IconButton } from "../../components/IconButton.tsx";
import * as engine from "../../lib/engine.ts";
import { summarizeLuts } from "../../lib/lutSummary.ts";
import styles from "./LutDialog.module.css";

type Props = {
  /** Called after a LUT is added or removed, so the rest of the screen reads the library again. */
  onChanged: () => void;
  onClose: () => void;
};

const byName = (a: engine.LutInfo, b: engine.LutInfo) =>
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
        Puedes elegir varios archivos .cube a la vez, o una carpeta entera.
      </p>
      <ul className={styles.list} aria-label="LUT guardados">
        {[...luts].sort(byName).map((lut) => (
          <li key={lut.id} className={styles.row}>
            <span className={styles.name}>{lut.name}</span>
            <span className={styles.size}>
              {lut.size}×{lut.size}×{lut.size}
            </span>
            <IconButton icon="x" label={`Quitar ${lut.name}`} onClick={() => void remove(lut)} />
          </li>
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
