import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Dialog } from "../../components/Dialog.tsx";
import { IconButton } from "../../components/IconButton.tsx";
import * as engine from "../../lib/engine.ts";
import styles from "./LutDialog.module.css";

type Props = {
  /** Called after a LUT is added or removed, so the rest of the screen reads the library again. */
  onChanged: () => void;
  onClose: () => void;
};

const INVALID = "Ese archivo no es un LUT 3D .cube válido.";

/** The LUTs kept in the program: load one once and it stays for every photo and every session. */
export function LutDialog({ onChanged, onClose }: Props) {
  const [luts, setLuts] = useState<engine.LutInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");

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

  async function load() {
    setError(null);
    try {
      const path = await engine.pickLut();
      if (path === null) return;
      const added = await engine.addLut(path);
      await refresh();
      onChanged();
      setStatus(`Se cargó ${added.name}. Queda guardado en el programa.`);
    } catch (failure) {
      const invalid = failure instanceof engine.EngineError && failure.code === -32602;
      setError(invalid ? INVALID : "No se pudo cargar el LUT.");
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
      <Button variant="primary" icon="folder" onClick={() => void load()}>
        Cargar LUT (.cube)…
      </Button>
      <ul className={styles.list} aria-label="LUT guardados">
        {luts.map((lut) => (
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
